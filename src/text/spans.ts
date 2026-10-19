/** A half-open range of document (or line) offsets. */
export interface Span {
	from: number;
	to: number;
}

/** The subset of CodeMirror's `Line` used by the text helpers. */
export interface LineLike {
	readonly number: number;
	readonly from: number;
	readonly to: number;
	readonly text: string;
}

/** The subset of CodeMirror's `Text` used by the text helpers, so they can be tested without an editor. */
export interface DocLike {
	readonly length: number;
	readonly lines: number;
	line(n: number): LineLike;
	lineAt(pos: number): LineLike;
	sliceString(from: number, to?: number): string;
}

export function overlaps(a: Span, b: Span): boolean {
	return a.from < b.to && b.from < a.to;
}

export function containsSpan(outer: Span, inner: Span): boolean {
	return outer.from <= inner.from && inner.to <= outer.to;
}
