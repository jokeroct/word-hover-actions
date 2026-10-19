import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
	type App,
	type Editor,
	Notice,
	SuggestModal,
	type TFile,
	editorInfoField,
	normalizePath,
	parseFrontMatterAliases,
	setIcon,
} from "obsidian";
import { aliasFor, escapeTablePipes } from "./text/links";
import {
	type CreatePlan,
	type NoteEntry,
	type NoteMatch,
	isAmbiguous,
	nameCounts,
	planCreate,
	rankNotes,
	suggestTitle,
} from "./text/notes";
import { type ColorPreset, themeClasses } from "./theme";

/** Everything needed to replace the hovered text with a link once a note is chosen. */
export interface LinkRequest {
	view: EditorView;
	editor: Editor;
	sourcePath: string;
	from: number;
	to: number;
	/** The visible wording to preserve. */
	text: string;
	/** The document when the picker opened. Any edit since then cancels the replacement. */
	doc: Text;
	inTable: boolean;
	/** Called after the link is inserted, e.g. to offer follow-ups. Without it, a created note gets a plain notice. */
	onLinked?: (file: TFile, created: boolean) => void;
}

type Suggestion =
	| { kind: "note"; match: NoteMatch; file: TFile; showPath: boolean }
	| { kind: "create"; plan: CreatePlan; title: string };

const CHANGED_MESSAGE = "The note changed while the picker was open, so the link was not inserted.";

/** True while the editor still shows the same document (same file, no edits) the request was made against. */
export function stillValid(request: Pick<LinkRequest, "view" | "doc" | "sourcePath">): boolean {
	const { view } = request;
	if (!view.dom.isConnected || view.state.doc !== request.doc) return false;
	return (view.state.field(editorInfoField, false)?.file?.path ?? "") === request.sourcePath;
}

function insertLink(app: App, request: LinkRequest, file: TFile, created: boolean): void {
	const linktext = app.metadataCache.fileToLinktext(file, request.sourcePath, true);
	let link = app.fileManager.generateMarkdownLink(file, request.sourcePath, undefined, aliasFor(request.text, linktext));
	if (request.inTable) link = escapeTablePipes(link);
	const { editor } = request;
	editor.transaction({ changes: [{ from: editor.offsetToPos(request.from), to: editor.offsetToPos(request.to), text: link }] });
	editor.focus();
	if (request.onLinked) request.onLinked(file, created);
	else if (created) new Notice(`Created “${file.path}”`);
}

/** Replaces the request's text with a link to an existing note, unless the document changed. */
export function linkExisting(app: App, request: LinkRequest, file: TFile): void {
	if (!stillValid(request)) {
		new Notice(CHANGED_MESSAGE);
		return;
	}
	insertLink(app, request, file, false);
}

/**
 * Whether a file or folder already exists at `path`. Plans are checked case-insensitively when
 * they are made; this is the last exact check before creating, and `Vault.create` itself refuses
 * to overwrite.
 */
export function pathTaken(app: App, path: string): boolean {
	return app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
}

/**
 * Creates the note with `content` (never overwriting or duplicating an existing path), links
 * the request's text to it, and stays in the current note.
 */
export async function createAndLink(app: App, request: LinkRequest, plan: CreatePlan, content = ""): Promise<void> {
	if (!plan.ok) {
		new Notice(plan.reason);
		return;
	}
	if (!stillValid(request)) {
		new Notice(CHANGED_MESSAGE);
		return;
	}
	if (pathTaken(app, plan.path)) {
		new Notice(`“${plan.path}” already exists, so no note was created.`);
		return;
	}
	let file: TFile;
	try {
		file = await app.vault.create(normalizePath(plan.path), content);
	} catch (error) {
		new Notice(`Couldn't create “${plan.path}”: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (!stillValid(request)) {
		new Notice(`Created “${file.path}”, but the note changed in the meantime, so the link was not inserted.`);
		return;
	}
	insertLink(app, request, file, true);
}

/** Search existing notes or create one from an editable title, then replace the hovered text with a link. */
export class NotePickerModal extends SuggestModal<Suggestion> {
	private readonly entries: NoteEntry[] = [];
	private readonly files = new Map<string, TFile>();
	private readonly counts: Map<string, number>;
	private readonly folderPath: string;

	constructor(
		app: App,
		private readonly request: LinkRequest,
		preset: ColorPreset = "accent",
	) {
		super(app);
		this.modalEl.addClass("wha-glass-modal", ...themeClasses(preset));
		for (const file of app.vault.getMarkdownFiles()) {
			const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
			const aliases = parseFrontMatterAliases(frontmatter) ?? [];
			this.entries.push({ path: file.path, basename: file.basename, aliases, mtime: file.stat.mtime });
			this.files.set(file.path, file);
		}
		this.counts = nameCounts(this.entries);
		this.folderPath = app.fileManager.getNewFileParent(request.sourcePath, "untitled.md").path;
		this.limit = 50;
		this.emptyStateText = "No matching notes";
		this.setPlaceholder("Find a note, or type a title for a new one");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to link" },
			{ command: "shift ↵", purpose: "to create from the title" },
			{ command: "esc", purpose: "to cancel" },
		]);
		this.scope.register(["Shift"], "Enter", (event) => {
			event.preventDefault();
			this.createFromInput();
			return false;
		});
	}

	onOpen(): void {
		super.onOpen();
		this.inputEl.value = suggestTitle(this.request.text);
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.select();
	}

	getSuggestions(query: string): Suggestion[] {
		const matches = rankNotes(query, this.entries, this.limit);
		const notes = (exact: boolean): Suggestion[] =>
			matches
				.filter((m) => m.exact === exact)
				.map((match) => ({
					kind: "note" as const,
					match,
					file: this.files.get(match.note.path)!,
					showPath: isAmbiguous(match.note, this.counts),
				}));
		const title = query.trim();
		const plan = planCreate(title, this.folderPath, this.files.keys());
		// When the note already exists at the destination it is listed (as an exact match); offering to create it again would only fail.
		const create: Suggestion[] = title && !(!plan.ok && plan.existingPath) ? [{ kind: "create", plan, title }] : [];
		return [...notes(true), ...create, ...notes(false)];
	}

	renderSuggestion(item: Suggestion, el: HTMLElement): void {
		el.addClass("mod-complex", "wha-suggestion");
		const content = el.createDiv({ cls: "suggestion-content" });
		if (item.kind === "note") {
			const { file, match, showPath } = item;
			content.createDiv({ cls: "suggestion-title", text: file.basename });
			if (match.matchedAlias) content.createDiv({ cls: "suggestion-note", text: `Alias: ${match.matchedAlias}` });
			if (showPath) content.createDiv({ cls: "suggestion-note", text: file.path });
			return;
		}
		const { plan, title } = item;
		el.addClass("wha-create");
		const aux = el.createDiv({ cls: "suggestion-aux" });
		setIcon(aux.createSpan({ cls: "suggestion-flair" }), "file-plus");
		if (!plan.ok) {
			el.addClass("is-disabled");
			content.createDiv({ cls: "suggestion-title", text: `Can't create “${title}”` });
			content.createDiv({ cls: "suggestion-note", text: plan.reason });
			return;
		}
		content.createDiv({ cls: "suggestion-title", text: `Create “${plan.title}”` });
		content.createDiv({ cls: "suggestion-note", text: `New note in ${plan.folder ? `${plan.folder}/` : "the vault root"}` });
		if (plan.sameNameElsewhere.length > 0) {
			const others = plan.sameNameElsewhere.join(", ");
			content.createDiv({ cls: "suggestion-note wha-warning", text: `A note with this name already exists: ${others}` });
		}
	}

	selectSuggestion(value: Suggestion, evt: MouseEvent | KeyboardEvent): void {
		if (evt instanceof KeyboardEvent && evt.shiftKey && evt.key === "Enter") {
			this.createFromInput();
			return;
		}
		// Keep the picker open so the title can be fixed.
		if (value.kind === "create" && !value.plan.ok) {
			new Notice(value.plan.reason);
			return;
		}
		super.selectSuggestion(value, evt);
	}

	onChooseSuggestion(item: Suggestion): void {
		if (item.kind === "note") linkExisting(this.app, this.request, item.file);
		else void createAndLink(this.app, this.request, item.plan);
	}

	private createFromInput(): void {
		const plan = planCreate(this.inputEl.value, this.folderPath, this.files.keys());
		if (!plan.ok) {
			new Notice(plan.reason);
			return;
		}
		this.close();
		void createAndLink(this.app, this.request, plan);
	}
}
