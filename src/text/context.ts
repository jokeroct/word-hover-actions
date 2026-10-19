import { REASON } from "./reasons";
import { type DocLike, type Span, overlaps } from "./spans";

/** Inline code spans (`code`, ``co`de``) within one line, in line offsets. */
export function inlineCodeSpans(text: string): Span[] {
	const spans: Span[] = [];
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] !== "`") {
			i++;
			continue;
		}
		let runEnd = i;
		while (text[runEnd] === "`") runEnd++;
		const size = runEnd - i;
		let close = -1;
		let k = runEnd;
		while (k < text.length) {
			if (text[k] !== "`") {
				k++;
				continue;
			}
			let m = k;
			while (text[m] === "`") m++;
			if (m - k === size) {
				close = k;
				break;
			}
			k = m;
		}
		if (close < 0) {
			i = runEnd;
			continue;
		}
		spans.push({ from: i, to: close + size });
		i = close + size;
	}
	return spans;
}

const LINK_PATTERNS: readonly RegExp[] = [
	// [[wikilink]], [[note|alias]], ![[embed]]
	/!?\[\[[^[\]\n]*\]\]/g,
	// [text](url), ![image](url), [text](<url with spaces> "title")
	/!?\[(?:\\.|[^[\]\\\n])*\]\((?:<[^<>\n]*>|(?:\\.|[^()\s\\]|\((?:\\.|[^()\s\\])*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g,
	// [text][reference]
	/!?\[(?:\\.|[^[\]\\\n])+\]\[[^[\]\n]*\]/g,
	// <https://autolink>
	/<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/g,
	// bare https://urls and obsidian://urls
	/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g,
];

const TAG_PATTERN = /(^|\s)(#[^\s#!@$%^&*(),.?":{}|<>[\]\\`'=+;~]+)/gu;

function startsInside(spans: readonly Span[], pos: number): boolean {
	return spans.some((s) => s.from <= pos && pos < s.to);
}

/** Links of any markdown or wikilink flavour within one line, ignoring ones inside inline code. */
export function linkSpans(text: string, code: readonly Span[] = inlineCodeSpans(text)): Span[] {
	const spans: Span[] = [];
	for (const pattern of LINK_PATTERNS) {
		pattern.lastIndex = 0;
		for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
			if (!startsInside(code, m.index)) spans.push({ from: m.index, to: m.index + m[0].length });
		}
	}
	return spans;
}

/** #tags within one line. Purely numeric "tags" like #2024 are not tags in Obsidian. */
export function tagSpans(text: string, code: readonly Span[] = inlineCodeSpans(text)): Span[] {
	const spans: Span[] = [];
	TAG_PATTERN.lastIndex = 0;
	for (let m = TAG_PATTERN.exec(text); m; m = TAG_PATTERN.exec(text)) {
		const from = m.index + m[1].length;
		if (/^#[\d/]+$/.test(m[2]) || startsInside(code, from)) continue;
		spans.push({ from, to: from + m[2].length });
	}
	return spans;
}

/** Line number of the closing `---` of YAML frontmatter, or 0 when the note has none. */
export function frontmatterEnd(doc: DocLike): number {
	if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
	for (let n = 2; n <= doc.lines; n++) {
		const text = doc.line(n).text.trimEnd();
		if (text === "---" || text === "...") return n;
	}
	return 0;
}

const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})(.*)$/;
const MATH_FENCE = /^(?:[ \t]*>)*[ \t]*\$\$/;

function countMathDelimiters(text: string): number {
	return text.match(/\$\$/g)?.length ?? 0;
}

export type BlockKind = "code" | "math" | null;

/** Walks lines top to bottom, reporting whether each is part of a fenced code block or a $$ math block. */
class BlockScanner {
	private fence: { char: string; size: number } | null = null;
	private inMath = false;

	/** The kind of this line (fence and delimiter lines included), advancing the scanner's state. */
	next(text: string): BlockKind {
		if (this.fence) {
			const m = FENCE.exec(text);
			if (m && m[1][0] === this.fence.char && m[1].length >= this.fence.size && m[2].trim() === "") this.fence = null;
			return "code";
		}
		if (this.inMath) {
			if (countMathDelimiters(text) % 2 === 1) this.inMath = false;
			return "math";
		}
		const m = FENCE.exec(text);
		if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
			this.fence = { char: m[1][0], size: m[1].length };
			return "code";
		}
		if (MATH_FENCE.test(text)) {
			if (countMathDelimiters(text) % 2 === 1) this.inMath = true;
			return "math";
		}
		return null;
	}
}

/** Whether a line sits inside (or is a fence of) a fenced code block or a $$ math block. */
export function blockKindAt(doc: DocLike, lineNumber: number, startAfter = frontmatterEnd(doc)): BlockKind {
	const scanner = new BlockScanner();
	let kind: BlockKind = null;
	for (let n = startAfter + 1; n <= lineNumber; n++) kind = scanner.next(doc.line(n).text);
	return lineNumber > startAfter ? kind : null;
}

/** The block kind of every line, indexed by line number (index 0 unused). Frontmatter lines are "frontmatter". */
export function lineKinds(doc: DocLike): Array<BlockKind | "frontmatter"> {
	const fmEnd = frontmatterEnd(doc);
	const kinds: Array<BlockKind | "frontmatter"> = [null];
	const scanner = new BlockScanner();
	for (let n = 1; n <= doc.lines; n++) kinds.push(n <= fmEnd ? "frontmatter" : scanner.next(doc.line(n).text));
	return kinds;
}

/**
 * Why a single-line range can't be acted on, judged from the markdown text alone:
 * frontmatter, code, math, links, and tags. Returns null when the range is plain text.
 */
export function blockReason(doc: DocLike, from: number, to: number): string | null {
	const line = doc.lineAt(from);
	const fmEnd = frontmatterEnd(doc);
	if (fmEnd > 0 && line.number <= fmEnd) return REASON.frontmatter;
	const block = blockKindAt(doc, line.number, fmEnd);
	if (block === "code") return REASON.codeBlock;
	if (block === "math") return REASON.math;

	const range = { from: from - line.from, to: to - line.from };
	const code = inlineCodeSpans(line.text);
	if (code.some((s) => overlaps(s, range))) return REASON.inlineCode;
	if (linkSpans(line.text, code).some((s) => overlaps(s, range))) return REASON.link;
	if (tagSpans(line.text, code).some((s) => overlaps(s, range))) return REASON.tag;
	return null;
}

/**
 * Maps an Obsidian editor syntax-node name (e.g. "formatting-code_inline-code") to a reason,
 * catching cases the text scan misses, such as inline math or indented code.
 */
export function reasonForNodeName(name: string): string | null {
	const n = name.toLowerCase();
	if (n.includes("frontmatter")) return REASON.frontmatter;
	if (n.includes("code")) return REASON.code;
	if (n.includes("math")) return REASON.math;
	if (n.includes("hashtag")) return REASON.tag;
	if (n.includes("link") || n.includes("url") || n.includes("embed")) return REASON.link;
	return null;
}
