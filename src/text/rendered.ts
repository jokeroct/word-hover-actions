import type { DocLike, Span } from "./spans";

const QUOTE_LINE = /^\s*>/;
/** A callout's opening marker, e.g. `> [!note]`, `> [!PDF|yellow]-` or `> > [!tip]+`. */
const CALLOUT_MARKER = /^[\s>]*\[![^\]\n]*\][+-]?/;

/**
 * The run of quote lines (`>`) around `pos`: the markdown a callout is rendered from in Live
 * Preview. Null when `pos` isn't on a quote line.
 */
export function quoteBlockAt(doc: DocLike, pos: number): Span | null {
	const line = doc.lineAt(pos);
	if (!QUOTE_LINE.test(line.text)) return null;
	let first = line.number;
	let last = line.number;
	while (first > 1 && QUOTE_LINE.test(doc.line(first - 1).text)) first--;
	while (last < doc.lines && QUOTE_LINE.test(doc.line(last + 1).text)) last++;
	return { from: doc.line(first).from, to: doc.line(last).to };
}

/** Where a callout block's opening marker ends, as an offset into the block; 0 when it has none. */
export function calloutMarkerEnd(block: string): number {
	return CALLOUT_MARKER.exec(block)?.[0].length ?? 0;
}

/**
 * Finds where each piece of rendered text sits in the markdown it was rendered from. Pieces come
 * in reading order and are matched in that order, each at its first occurrence after the previous
 * match, which steps over what rendering hides: quote prefixes, formatting markers, link targets.
 * A piece that is only whitespace, or doesn't appear verbatim (an escaped character, an HTML
 * entity), maps to null and doesn't move the search on.
 */
export function locatePieces(source: string, pieces: readonly string[]): Array<number | null> {
	let cursor = 0;
	return pieces.map((piece) => {
		if (!piece.trim()) return null;
		const index = source.indexOf(piece, cursor);
		if (index < 0) return null;
		cursor = index + piece.length;
		return index;
	});
}

/** Splits text at line breaks, keeping each line's offset; rendered soft breaks don't exist in the source. */
export function splitLines(text: string): Array<{ text: string; offset: number }> {
	const lines: Array<{ text: string; offset: number }> = [];
	let offset = 0;
	for (const line of text.split("\n")) {
		lines.push({ text: line, offset });
		offset += line.length + 1;
	}
	return lines;
}
