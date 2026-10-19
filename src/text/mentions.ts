import { inlineCodeSpans, lineKinds, linkSpans, tagSpans } from "./context";
import { type DocLike, type Span, overlaps } from "./spans";
import { JOINERS, codePointAt, codePointBefore, isWord } from "./word";

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the match edge at `pos` is not glued to a neighbouring word (so "TB" doesn't match in "TBS" or "TB-related"). */
function atWordEdge(text: string, pos: number, side: "before" | "after"): boolean {
	const neighbour = side === "before" ? codePointBefore(text, pos) : codePointAt(text, pos);
	if (!neighbour) return true;
	if (isWord(neighbour)) return false;
	if (!JOINERS.has(neighbour.cp)) return true;
	const beyond = side === "before" ? codePointBefore(text, pos - neighbour.len) : codePointAt(text, pos + neighbour.len);
	return !isWord(beyond);
}

/**
 * Plain-text mentions of `term` in the note: whole words, any letter case, any run of spaces
 * between words. Skips frontmatter, code, math, existing links, URLs, and tags.
 */
export function findMentions(doc: DocLike, term: string): Span[] {
	const words = term.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"), "giu");
	const kinds = lineKinds(doc);
	const mentions: Span[] = [];
	for (let n = 1; n <= doc.lines; n++) {
		if (kinds[n] !== null) continue;
		const line = doc.line(n);
		let opaque: Span[] | null = null;
		pattern.lastIndex = 0;
		for (let m = pattern.exec(line.text); m; m = pattern.exec(line.text)) {
			const span = { from: m.index, to: m.index + m[0].length };
			if (!atWordEdge(line.text, span.from, "before") || !atWordEdge(line.text, span.to, "after")) continue;
			if (!opaque) {
				const code = inlineCodeSpans(line.text);
				opaque = [...code, ...linkSpans(line.text, code), ...tagSpans(line.text, code)];
			}
			if (opaque.some((s) => overlaps(s, span))) continue;
			mentions.push({ from: line.from + span.from, to: line.from + span.to });
		}
	}
	return mentions;
}
