import { blockReason, frontmatterEnd } from "./context";
import { type FormatPlan, planFormat } from "./format";
import { type LinkInfo, linkAt } from "./links";
import { REASON } from "./reasons";
import type { DocLike, Span } from "./spans";
import { wordAt } from "./word";

export type TargetSource = "word" | "selection";

export type LinkPlan = ({ ok: true; text: string } & Span) | { ok: false; reason: string };
export type ExtractPlan = ({ ok: true; text: string } & Span) | { ok: false; reason: string };
export type LookupPlan = { ok: true; term: string } | { ok: false; reason: string };

/** An existing link that wholly contains the target, with its position in the document. */
export interface ExistingLink extends LinkInfo {
	docFrom: number;
	docTo: number;
}

export interface HoverTarget extends Span {
	text: string;
	source: TargetSource;
	/** Set when no editing action may touch this target (code, link, tag, multiline selection…). */
	blocked: string | null;
	/** The link the target sits in, if any; the wheel then offers link tools instead. */
	existingLink: ExistingLink | null;
	bold: FormatPlan;
	italic: FormatPlan;
	highlight: FormatPlan;
	strikethrough: FormatPlan;
	link: LinkPlan;
	/** Extract works on any selected passage, including several lines. */
	extract: ExtractPlan;
	/** Look-ups only read, so they work in code and links too. */
	lookup: LookupPlan;
}

/** Optional extra check, e.g. against the editor's syntax tree. Returns a reason to block, or null. */
export type ExtraCheck = (from: number, to: number) => string | null;

function trimmed(doc: DocLike, span: Span): Span | null {
	const text = doc.sliceString(span.from, span.to);
	const lead = text.length - text.trimStart().length;
	const trail = text.length - text.trimEnd().length;
	if (lead + trail >= text.length) return null;
	return { from: span.from + lead, to: span.to - trail };
}

const WRAPPERS = ["**", "__", "==", "~~", "*", "_"];

/**
 * The part of the target that becomes the link. Formatting that wraps the whole target stays
 * outside the link, so a selected `**word**` becomes `**[[word]]**`.
 */
function planLink(doc: DocLike, span: Span): LinkPlan {
	let { from, to } = span;
	let text = doc.sliceString(from, to);
	for (let changed = true; changed; ) {
		changed = false;
		for (const w of WRAPPERS) {
			const inner = text.slice(w.length, text.length - w.length);
			if (text.length > 2 * w.length && text.startsWith(w) && text.endsWith(w) && !inner.includes(w)) {
				from += w.length;
				to -= w.length;
				text = inner;
				changed = true;
				break;
			}
		}
	}
	const lead = text.length - text.trimStart().length;
	const trail = text.length - text.trimEnd().length;
	from += lead;
	to -= trail;
	text = text.trim();
	if (!text) return { ok: false, reason: "Nothing to link" };
	if (/[[\]|]/.test(text)) return { ok: false, reason: REASON.linkChars };
	return { ok: true, from, to, text };
}

const MAX_LOOKUP_LENGTH = 80;

function planLookup(text: string, multiline: boolean): LookupPlan {
	if (multiline) return { ok: false, reason: REASON.multiline };
	const term = text.replace(/[*=~`]+/g, "").replace(/\s+/g, " ").trim();
	if (!term) return { ok: false, reason: "Nothing to look up" };
	if (term.length > MAX_LOOKUP_LENGTH) return { ok: false, reason: "Too long to look up" };
	return { ok: true, term };
}

function planExtract(doc: DocLike, span: Span, source: TargetSource, text: string): ExtractPlan {
	if (source !== "selection") return { ok: false, reason: "Select a passage to extract" };
	const fmEnd = frontmatterEnd(doc);
	if (fmEnd > 0 && doc.lineAt(span.from).number <= fmEnd) return { ok: false, reason: REASON.frontmatter };
	return { ok: true, from: span.from, to: span.to, text };
}

function enclosingLink(doc: DocLike, span: Span): ExistingLink | null {
	const line = doc.lineAt(span.from);
	const link = linkAt(line.text, span.from - line.from);
	if (!link || line.from + link.to < span.to) return null;
	return { ...link, docFrom: line.from + link.from, docTo: line.from + link.to };
}

/**
 * Resolves what an action would apply to when the pointer is over the character at `charIndex`:
 * a non-empty selection containing that character wins (trimmed of surrounding whitespace),
 * otherwise the word under the pointer. Returns null when there is nothing to act on.
 */
export function resolveTarget(
	doc: DocLike,
	charIndex: number,
	selections: readonly Span[],
	extraCheck?: ExtraCheck,
): HoverTarget | null {
	if (charIndex < 0 || charIndex >= doc.length) return null;
	const selection = selections.find((r) => r.from < r.to && r.from <= charIndex && charIndex < r.to);
	let span: Span | null;
	let source: TargetSource;
	if (selection) {
		span = trimmed(doc, selection);
		source = "selection";
	} else {
		const line = doc.lineAt(charIndex);
		const word = wordAt(line.text, charIndex - line.from);
		span = word && { from: line.from + word.from, to: line.from + word.to };
		source = "word";
	}
	if (!span) return null;

	const text = doc.sliceString(span.from, span.to);
	const multiline = doc.lineAt(span.from).number !== doc.lineAt(span.to).number;
	const blocked = multiline
		? REASON.multiline
		: (blockReason(doc, span.from, span.to) ?? extraCheck?.(span.from, span.to) ?? null);
	const refused = { ok: false as const, reason: blocked ?? "" };
	const editable = blocked === null;
	return {
		...span,
		text,
		source,
		blocked,
		existingLink: multiline ? null : enclosingLink(doc, span),
		bold: editable ? planFormat(doc, span, "bold") : refused,
		italic: editable ? planFormat(doc, span, "italic") : refused,
		highlight: editable ? planFormat(doc, span, "highlight") : refused,
		strikethrough: editable ? planFormat(doc, span, "strikethrough") : refused,
		link: editable ? planLink(doc, span) : refused,
		extract: planExtract(doc, span, source, text),
		lookup: planLookup(text, multiline),
	};
}
