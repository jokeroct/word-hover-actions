/** Actions that can be placed in a wheel slot. */
export type BuiltinActionId = "link" | "bold" | "italic" | "highlight" | "strikethrough" | "extract" | "define" | "shorten";
/** A slot holds a built-in action, a custom wrapper (`custom:<id>`), or nothing. */
export type SlotAction = BuiltinActionId | `custom:${string}` | "none";
/** Tools offered when the hovered word is already a link. */
export type LinkToolId = "peek" | "unlink" | "retarget" | "open-split";

export interface ActionInfo {
	/** Short label under the icon. */
	label: string;
	/** Full name shown in the wheel's center on hover. */
	title: string;
	/** Center text when the formatting is already applied. */
	activeTitle?: string;
	icon: string;
}

export const BUILTIN_ACTIONS: Record<BuiltinActionId, ActionInfo> = {
	link: { label: "Link", title: "Link/create note", icon: "link" },
	bold: { label: "Bold", title: "Bold", activeTitle: "Remove bold", icon: "bold" },
	italic: { label: "Italic", title: "Italic", activeTitle: "Remove italic", icon: "italic" },
	highlight: { label: "Highlight", title: "Highlight", activeTitle: "Remove highlight", icon: "highlighter" },
	strikethrough: { label: "Strike", title: "Strikethrough", activeTitle: "Remove strikethrough", icon: "strikethrough" },
	extract: { label: "Extract", title: "Extract to note", icon: "file-output" },
	define: { label: "Define", title: "Look up on Wikipedia and Wiktionary", icon: "book-open" },
	shorten: { label: "Shorten", title: "Shorten the paragraph or selection", icon: "scissors" },
};

export const LINK_TOOLS: Record<LinkToolId, ActionInfo> = {
	peek: { label: "Peek", title: "Preview the note", icon: "eye" },
	unlink: { label: "Unlink", title: "Remove the link, keep the text", icon: "unlink" },
	retarget: { label: "Change", title: "Link to a different note", icon: "replace" },
	"open-split": { label: "Split", title: "Open in a split pane", icon: "separator-vertical" },
};

/** Link tools clockwise from the top: Peek, Unlink, Change target, Open in split. */
export const LINK_TOOL_ORDER: readonly LinkToolId[] = ["peek", "unlink", "retarget", "open-split"];

export const isBuiltin = (id: string): id is BuiltinActionId => Object.prototype.hasOwnProperty.call(BUILTIN_ACTIONS, id);
