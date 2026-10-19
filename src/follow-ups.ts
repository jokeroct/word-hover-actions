import type { EditorView } from "@codemirror/view";
import { type App, type Editor, Notice, type TFile, editorInfoField, parseFrontMatterAliases, setIcon } from "obsidian";
import type { WordHoverSettings } from "./settings-model";
import { aliasFor, escapeTablePipes, isTableRow } from "./text/links";
import { findMentions } from "./text/mentions";
import { normalizeName, shouldOfferAlias } from "./text/notes";
import { themeClasses } from "./theme";

export interface LinkedContext {
	app: App;
	settings: WordHoverSettings;
	view: EditorView;
	editor: Editor;
	sourcePath: string;
	file: TFile;
	/** The wording that was linked. */
	text: string;
	created: boolean;
}

const TOAST_MS = 12_000;

/** Adds `alias` to the note's `aliases` property unless an equivalent alias is already there. */
export async function addAlias(app: App, file: TFile, alias: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		const current = frontmatter.aliases;
		const list = Array.isArray(current) ? current.map(String) : typeof current === "string" && current ? [current] : [];
		if (!list.some((a) => normalizeName(a) === normalizeName(alias))) list.push(alias);
		frontmatter.aliases = list;
	});
}

/** Links every remaining plain mention of `text` in the editor's note to `file`, as one undoable edit. */
export function linkMentions(ctx: Omit<LinkedContext, "settings" | "created">): number {
	const { app, view, editor, sourcePath, file, text } = ctx;
	if ((view.state.field(editorInfoField, false)?.file?.path ?? "") !== sourcePath) return 0;
	const doc = view.state.doc;
	const linktext = app.metadataCache.fileToLinktext(file, sourcePath, true);
	const changes = findMentions(doc, text).map((span) => {
		const wording = doc.sliceString(span.from, span.to);
		let link = app.fileManager.generateMarkdownLink(file, sourcePath, undefined, aliasFor(wording, linktext));
		if (isTableRow(doc.lineAt(span.from).text)) link = escapeTablePipes(link);
		return { from: editor.offsetToPos(span.from), to: editor.offsetToPos(span.to), text: link };
	});
	if (changes.length > 0) editor.transaction({ changes });
	return changes.length;
}

/**
 * After a link is inserted: offers to save the wording as an alias of the target note and to link
 * the other mentions, in one notice. Shows nothing when there is nothing to offer or report.
 */
export function offerFollowUps(ctx: LinkedContext): void {
	const { app, settings, file, text } = ctx;
	const messages: string[] = [];
	const buttons: Array<{ label: string; done: string; run: () => void | Promise<void> }> = [];

	if (ctx.created) messages.push(`Created “${file.path}”.`);

	const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter) ?? [];
	if (settings.learnAliases !== "never" && shouldOfferAlias(text, file.basename, aliases)) {
		if (settings.learnAliases === "always") {
			void addAlias(app, file, text);
			messages.push(`Added “${text}” as an alias of ${file.basename}.`);
		} else {
			buttons.push({
				label: `Add “${text}” as alias`,
				done: `✓ Alias “${text}” added`,
				run: () => addAlias(app, file, text),
			});
		}
	}

	const mentions = settings.offerLinkAll ? findMentions(ctx.view.state.doc, text).length : 0;
	if (mentions > 0) {
		buttons.push({
			label: `Link ${mentions} more mention${mentions === 1 ? "" : "s"}`,
			done: "✓ Linked (Ctrl+Z undoes it)",
			run: () => {
				if (linkMentions(ctx) === 0) new Notice("No other mentions left to link.");
			},
		});
	}

	if (buttons.length === 0) {
		if (messages.length > 0) new Notice(messages.join(" "));
		return;
	}
	if (messages.length === 0) messages.push(`Linked to ${file.basename}.`);
	showToast(ctx.view.dom.ownerDocument, messages.join(" "), buttons, themeClasses(settings.colorPreset));
}

interface ToastButton {
	label: string;
	/** Replaces the label once the action succeeds. */
	done: string;
	run: () => void | Promise<void>;
}

/**
 * A small toast with action buttons. Obsidian's notices close on any press, which would allow
 * only one of several offers, so this one stays until every offer is used, it is closed, or it
 * times out (paused while the pointer is over it).
 */
function showToast(doc: Document, message: string, buttons: ToastButton[], classes: string[]): void {
	const win = doc.defaultView ?? window;
	doc.querySelector(".wha-toast")?.remove();
	const el = doc.body.createDiv({ cls: ["wha-toast", ...classes], attr: { role: "status" } });
	el.createDiv({ cls: "wha-toast-message", text: message });
	const close = el.createDiv({ cls: "wha-toast-close clickable-icon", attr: { "aria-label": "Close" } });
	setIcon(close, "x");

	let timer: number | null = null;
	const dismiss = () => {
		if (timer !== null) win.clearTimeout(timer);
		el.remove();
	};
	const schedule = (ms: number) => {
		if (timer !== null) win.clearTimeout(timer);
		timer = win.setTimeout(dismiss, ms);
	};
	close.addEventListener("click", dismiss);
	el.addEventListener("mouseenter", () => timer !== null && win.clearTimeout(timer));
	el.addEventListener("mouseleave", () => schedule(4000));

	let remaining = buttons.length;
	const row = el.createDiv({ cls: "wha-toast-actions" });
	for (const button of buttons) {
		const action = row.createEl("button", { cls: "mod-cta wha-btn-primary", text: button.label });
		const press = async () => {
			if (action.disabled) return;
			action.disabled = true;
			try {
				await button.run();
			} catch (error) {
				action.disabled = false;
				new Notice(`That didn't work: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			action.textContent = button.done;
			action.classList.remove("mod-cta", "wha-btn-primary");
			if (--remaining === 0) schedule(1500);
		};
		// press() catches and reports its own failures, so the promise can be dropped.
		action.addEventListener("click", () => void press());
	}
	schedule(TOAST_MS);
}
