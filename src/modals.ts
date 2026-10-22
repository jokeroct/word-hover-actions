import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
	type App,
	type ButtonComponent,
	Component,
	type Editor,
	Keymap,
	MarkdownRenderer,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	type TFile,
	normalizePath,
} from "obsidian";
import { lookupWikipedia, lookupWiktionary, wikipediaSearchUrl, wiktionaryUrl } from "./lookup-client";
import { type LinkRequest, createAndLink, linkExisting, pathTaken, stillValid } from "./note-picker";
import type { WordHoverSettings } from "./settings-model";
import { shortenWithOllama } from "./shorten-client";
import { type DictionaryEntry, type WikiSummary, noteFromPassage, noteFromSummary } from "./text/lookup";
import { planCreate, suggestTitle, suggestTitleFromPassage } from "./text/notes";
import { type Passage, SHORTEN_RATIOS, type ShortenLength, shortenText } from "./text/shorten";
import { themeClasses } from "./theme";

const newNoteFolder = (app: App, sourcePath: string) => app.fileManager.getNewFileParent(sourcePath, "untitled.md").path;
const allPaths = (app: App) => app.vault.getAllLoadedFiles().map((f) => f.path);

export function countBacklinks(app: App, file: TFile): number {
	return Object.values(app.metadataCache.resolvedLinks).filter((targets) => (targets[file.path] ?? 0) > 0).length;
}

// ---- Extract to note ------------------------------------------------------------------------

export interface ExtractRequest {
	view: EditorView;
	editor: Editor;
	sourcePath: string;
	sourceFile: TFile | null;
	from: number;
	to: number;
	text: string;
	doc: Text;
}

/** Moves a selected passage into a new note (with a `source` property linking back) and leaves a link or embed. */
export class ExtractModal extends Modal {
	private title: string;
	private replaceWith: "link" | "embed";
	private errorEl: HTMLElement | null = null;
	private busy = false;
	private readonly preset: WordHoverSettings["colorPreset"];

	constructor(
		app: App,
		settings: WordHoverSettings,
		private readonly request: ExtractRequest,
	) {
		super(app);
		this.title = suggestTitleFromPassage(request.text);
		this.replaceWith = settings.extractReplace;
		this.preset = settings.colorPreset;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Extract to note");
		this.modalEl.addClass("wha-glass-modal", ...themeClasses(this.preset));
		contentEl.addClass("wha-extract");
		const folder = newNoteFolder(this.app, this.request.sourcePath);

		new Setting(contentEl)
			.setName("Title")
			.setDesc(`New note in ${folder === "/" ? "the vault root" : `${folder}/`}`)
			.addText((text) => {
				text.setValue(this.title).onChange((value) => {
					this.title = value;
					this.validate();
				});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !event.isComposing) {
						event.preventDefault();
						void this.extract();
					}
				});
				window.setTimeout(() => text.inputEl.select(), 0);
			});
		this.errorEl = contentEl.createDiv({ cls: "wha-extract-error" });
		new Setting(contentEl).setName("Replace the passage with").addDropdown((dropdown) =>
			dropdown
				.addOptions({ link: "A link", embed: "An embed" })
				.setValue(this.replaceWith)
				.onChange((value) => {
					this.replaceWith = value === "embed" ? "embed" : "link";
				}),
		);
		const preview = this.request.text.length > 400 ? `${this.request.text.slice(0, 400)}…` : this.request.text;
		contentEl.createDiv({ cls: "wha-extract-preview", text: preview });
		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Extract").setCta().onClick(() => void this.extract()));
		this.validate();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private plan() {
		return planCreate(this.title, newNoteFolder(this.app, this.request.sourcePath), allPaths(this.app));
	}

	private validate(): boolean {
		const plan = this.plan();
		this.errorEl?.setText(plan.ok ? "" : plan.reason);
		return plan.ok;
	}

	private async extract(): Promise<void> {
		if (this.busy) return;
		const { app, request } = this;
		const plan = this.plan();
		if (!plan.ok) {
			this.errorEl?.setText(plan.reason);
			return;
		}
		if (!stillValid(request)) {
			new Notice("The note changed since you selected the passage, so nothing was extracted.");
			this.close();
			return;
		}
		this.busy = true;
		try {
			if (pathTaken(app, plan.path)) {
				this.errorEl?.setText(`“${plan.path}” already exists`);
				return;
			}
			const content = request.sourceFile
				? noteFromPassage(request.text, app.metadataCache.fileToLinktext(request.sourceFile, plan.path, true))
				: `${request.text}\n`;
			const file = await app.vault.create(normalizePath(plan.path), content);
			this.close();
			if (!stillValid(request)) {
				new Notice(`Created “${file.path}”, but the note changed in the meantime, so the passage was not replaced.`);
				return;
			}
			const link = app.fileManager.generateMarkdownLink(file, request.sourcePath);
			const { editor } = request;
			editor.transaction({
				changes: [
					{
						from: editor.offsetToPos(request.from),
						to: editor.offsetToPos(request.to),
						text: this.replaceWith === "embed" ? `!${link}` : link,
					},
				],
			});
			editor.focus();
			new Notice(`Extracted to “${file.path}”. Ctrl+Z restores the passage here.`);
		} catch (error) {
			this.errorEl?.setText(`Couldn't create the note: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.busy = false;
		}
	}
}

// ---- Define ---------------------------------------------------------------------------------

/**
 * Shows a Wikipedia summary and Wiktionary definitions for a term. "Create linked note" makes a
 * note from the summary (with its source URL) and links the term to it.
 */
export class DefineModal extends Modal {
	constructor(
		app: App,
		private readonly settings: WordHoverSettings,
		private readonly term: string,
		/** Set when the term may be replaced with a link; otherwise the note is only created. */
		private readonly linkRequest: LinkRequest | null,
		private readonly sourcePath: string,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const { contentEl, term } = this;
		const language = this.settings.lookupLanguage;
		this.titleEl.setText(term);
		this.modalEl.addClass("wha-glass-modal", ...themeClasses(this.settings.colorPreset));
		contentEl.addClass("wha-define");
		const status = contentEl.createDiv({ cls: "wha-define-status", text: "Looking up…" });
		const [wiki, dict] = await Promise.allSettled([lookupWikipedia(term, language), lookupWiktionary(term, language)]);
		status.remove();

		const summary = wiki.status === "fulfilled" ? wiki.value : null;
		const entries = dict.status === "fulfilled" ? dict.value : [];
		if (summary) this.renderSummary(summary);
		if (entries.length > 0) this.renderDictionary(entries);
		if (!summary && entries.length === 0) {
			const offline = wiki.status === "rejected" && dict.status === "rejected";
			contentEl.createDiv({
				cls: "wha-define-status",
				text: offline
					? "Couldn't reach Wikipedia or Wiktionary. Check your connection."
					: `No Wikipedia page or dictionary entry found for “${term}”.`,
			});
		}

		const buttons = new Setting(contentEl);
		if (summary && !summary.disambiguation) {
			buttons.addButton((button) =>
				button
					.setButtonText(this.linkRequest ? "Create linked note" : "Create note")
					.setCta()
					.onClick(() => void this.createNote(summary)),
			);
		}
		buttons.addButton((button) =>
			button.setButtonText(summary ? "Open on Wikipedia" : "Search Wikipedia").onClick(() => {
				window.open(summary?.url ?? wikipediaSearchUrl(term, language));
			}),
		);
		buttons.addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderSummary(summary: WikiSummary): void {
		const section = this.contentEl.createDiv({ cls: "wha-define-section" });
		section.createDiv({ cls: "wha-define-heading", text: `Wikipedia · ${summary.title}` });
		if (summary.description) section.createDiv({ cls: "wha-define-description", text: summary.description });
		if (summary.disambiguation) section.createDiv({ cls: "wha-define-note", text: "This term has several meanings on Wikipedia." });
		section.createEl("p", { text: summary.extract });
	}

	private renderDictionary(entries: DictionaryEntry[]): void {
		const section = this.contentEl.createDiv({ cls: "wha-define-section" });
		const heading = section.createDiv({ cls: "wha-define-heading" });
		heading.appendText("Wiktionary · ");
		heading.createEl("a", { text: this.term, href: wiktionaryUrl(this.term) });
		for (const entry of entries) {
			section.createDiv({ cls: "wha-define-pos", text: entry.partOfSpeech });
			const list = section.createEl("ol");
			for (const definition of entry.definitions) list.createEl("li", { text: definition });
		}
	}

	private async createNote(summary: WikiSummary): Promise<void> {
		const { app } = this;
		const title = suggestTitle(summary.title);
		const plan = planCreate(title, newNoteFolder(app, this.sourcePath), allPaths(app));
		if (!plan.ok && plan.existingPath) {
			const existing = app.vault.getFileByPath(plan.existingPath);
			this.close();
			if (existing && this.linkRequest) {
				linkExisting(app, this.linkRequest, existing);
				new Notice(`“${existing.path}” already exists, so the term was linked to it.`);
			} else {
				new Notice(`“${plan.existingPath}” already exists.`);
			}
			return;
		}
		if (!plan.ok) {
			new Notice(plan.reason);
			return;
		}
		this.close();
		if (this.linkRequest) {
			await createAndLink(app, this.linkRequest, plan, noteFromSummary(summary));
			return;
		}
		if (pathTaken(app, plan.path)) {
			new Notice(`“${plan.path}” already exists.`);
			return;
		}
		const file = await app.vault.create(normalizePath(plan.path), noteFromSummary(summary));
		new Notice(`Created “${file.path}”`);
	}
}

// ---- Shorten --------------------------------------------------------------------------------

export interface ShortenRequest {
	view: EditorView;
	editor: Editor;
	sourcePath: string;
	doc: Text;
	passage: Passage;
}

export const LENGTH_OPTIONS: Record<ShortenLength, string> = {
	third: "About a third",
	half: "About half",
	twoThirds: "About two-thirds",
};

const countWords = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/**
 * Shows a shorter version of a passage in an editable box, made offline or by a local AI (see
 * settings), with buttons to replace the passage, insert the short version below it, or copy it.
 */
export class ShortenModal extends Modal {
	private length: ShortenLength;
	private output: TextAreaComponent | null = null;
	private statusEl: HTMLElement | null = null;
	private readonly buttons: ButtonComponent[] = [];
	/** How the current text was made, shown above the word count. */
	private note = "";
	/** Bumped on each run, so a slow answer for an earlier length is ignored. */
	private run = 0;

	constructor(
		app: App,
		private readonly settings: WordHoverSettings,
		private readonly request: ShortenRequest,
	) {
		super(app);
		this.length = settings.shortenLength;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.titleEl.setText("Shorten");
		this.modalEl.addClass("wha-glass-modal", ...themeClasses(this.settings.colorPreset));
		contentEl.addClass("wha-shorten");
		new Setting(contentEl).setName("Length").addDropdown((dropdown) =>
			dropdown
				.addOptions(LENGTH_OPTIONS)
				.setValue(this.length)
				.onChange((value) => {
					this.length = value as ShortenLength;
					void this.generate();
				}),
		);
		this.output = new TextAreaComponent(contentEl);
		this.output.inputEl.addClass("wha-shorten-output");
		this.output.inputEl.rows = 8;
		this.output.onChange(() => this.showStats());
		this.statusEl = contentEl.createDiv({ cls: "wha-shorten-status" });
		new Setting(contentEl)
			.addButton((button) => {
				this.buttons.push(button.setButtonText("Copy").onClick(() => void this.copy()));
			})
			.addButton((button) => {
				this.buttons.push(button.setButtonText("Insert below").onClick(() => this.apply("below")));
			})
			.addButton((button) => {
				this.buttons.push(button.setButtonText("Replace").setCta().onClick(() => this.apply("replace")));
			});
		void this.generate();
	}

	onClose(): void {
		this.run++;
		this.contentEl.empty();
	}

	private async generate(): Promise<void> {
		const run = ++this.run;
		const { passage } = this.request;
		const ratio = SHORTEN_RATIOS[this.length];
		const builtin = () => shortenText(passage.text, ratio, this.settings.lookupLanguage);
		if (this.settings.shortenEngine !== "ollama") {
			this.show(builtin(), "Key sentences, in their original wording");
			return;
		}
		const { ollamaUrl, ollamaModel } = this.settings;
		this.setBusy(`Asking ${ollamaModel}…`);
		try {
			const text = await shortenWithOllama(passage.text, ratio, ollamaUrl, ollamaModel);
			if (run === this.run) this.show(text, `Rewritten by ${ollamaModel}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (run === this.run) this.show(builtin(), `${message} Showing the built-in version instead.`);
		}
	}

	private setBusy(status: string): void {
		this.output?.setDisabled(true);
		for (const button of this.buttons) button.setDisabled(true);
		this.statusEl?.setText(status);
	}

	private show(text: string, note: string): void {
		this.note = note;
		this.output?.setDisabled(false).setValue(text);
		for (const button of this.buttons) button.setDisabled(false);
		this.showStats();
	}

	private showStats(): void {
		const before = countWords(this.request.passage.text);
		const after = countWords(this.output?.getValue() ?? "");
		const percent = before ? Math.round((after / before) * 100) : 100;
		this.statusEl?.setText(`${this.note} · ${before} → ${after} words (${percent}%)`);
	}

	private async copy(): Promise<void> {
		const text = this.output?.getValue().trim() ?? "";
		if (!text) return;
		await navigator.clipboard.writeText(text);
		new Notice("Copied the shortened text");
	}

	private apply(mode: "replace" | "below"): void {
		const text = this.output?.getValue().trim() ?? "";
		if (!text) return;
		const { editor, passage } = this.request;
		if (!stillValid(this.request)) {
			new Notice("The note changed while the dialog was open, so nothing was changed.");
			this.close();
			return;
		}
		// Every line of the result stays inside the passage's quote or callout.
		const body = text.replace(/\n/g, `\n${passage.prefix}`);
		const change =
			mode === "replace"
				? { from: passage.from, to: passage.to, text: body }
				: { from: passage.insertAt, to: passage.insertAt, text: passage.separator + body };
		editor.transaction({
			changes: [{ from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.text }],
		});
		editor.focus();
		this.close();
	}
}

// ---- Peek -----------------------------------------------------------------------------------

/** A read-only preview of a linked note, with its backlink count and buttons to open it. */
export class PeekModal extends Modal {
	private readonly component = new Component();

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly settings: WordHoverSettings,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const { app, file, contentEl } = this;
		this.component.load();
		this.titleEl.setText(file.basename);
		this.modalEl.addClass("wha-glass-modal", ...themeClasses(this.settings.colorPreset));
		contentEl.addClass("wha-peek");
		const backlinks = countBacklinks(app, file);
		contentEl.createDiv({
			cls: "wha-peek-meta",
			text: `${file.path} · linked from ${backlinks} note${backlinks === 1 ? "" : "s"}`,
		});
		const body = contentEl.createDiv({ cls: "wha-peek-body markdown-rendered" });
		const markdown = await app.vault.cachedRead(file);
		const frontmatterEnd = app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
		const content = markdown.slice(frontmatterEnd).trim();
		if (content) await MarkdownRenderer.render(app, content, body, file.path, this.component);
		else body.createDiv({ cls: "wha-define-status", text: "This note is empty." });
		body.addEventListener("click", (event) => {
			const link = (event.target as HTMLElement).closest("a.internal-link");
			const href = link?.getAttribute("data-href");
			if (!href) return;
			event.preventDefault();
			this.close();
			void app.workspace.openLinkText(href, file.path, Keymap.isModEvent(event));
		});

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Open").onClick(() => {
					this.close();
					void app.workspace.getLeaf(false).openFile(file);
				}),
			)
			.addButton((button) =>
				button
					.setButtonText("Open in split")
					.setCta()
					.onClick(() => {
						this.close();
						void app.workspace.getLeaf("split").openFile(file);
					}),
			);
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}
}
