import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type App, Component, type Editor, Keymap, MarkdownRenderer, Modal, Notice, Setting, type TFile, normalizePath } from "obsidian";
import { lookupWikipedia, lookupWiktionary, wikipediaSearchUrl, wiktionaryUrl } from "./lookup-client";
import { type LinkRequest, createAndLink, linkExisting, pathTaken, stillValid } from "./note-picker";
import type { WordHoverSettings } from "./settings-model";
import { type DictionaryEntry, type WikiSummary, noteFromPassage, noteFromSummary } from "./text/lookup";
import { planCreate, suggestTitle, suggestTitleFromPassage } from "./text/notes";
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
