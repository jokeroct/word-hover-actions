import { inlineCodeSpans, linkSpans } from "./context";
import { REASON } from "./reasons";
import { type DocLike, type Span, containsSpan, overlaps } from "./spans";

export type FormatKind = "bold" | "italic" | "highlight" | "strikethrough";

/** One replacement, in document offsets relative to the document before any change is applied. */
export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

export type FormatPlan =
	| {
			ok: true;
			/** True when the target is already formatted, so the plan removes the formatting. */
			active: boolean;
			/** Non-overlapping, ascending changes. */
			changes: TextChange[];
			/** The target's text in the document after the changes, without the markers. */
			selection: Span;
	  }
	| { ok: false; reason: string };

interface FormatSpec {
	label: string;
	wrap: string;
	/** Marker characters recognised when detecting existing formatting (`**` and `__` both mean bold). */
	chars: readonly string[];
	/** Marker length: 2 for `**`/`==`, 1 for `*`. */
	size: 1 | 2;
}

const SPECS: Record<FormatKind, FormatSpec> = {
	bold: { label: "bold", wrap: "**", chars: ["*", "_"], size: 2 },
	italic: { label: "italic", wrap: "*", chars: ["*", "_"], size: 1 },
	highlight: { label: "highlight", wrap: "==", chars: ["="], size: 2 },
	strikethrough: { label: "strikethrough", wrap: "~~", chars: ["~"], size: 2 },
};

interface MarkerPair {
	open: Span;
	close: Span;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Whether a run of marker characters can carry a marker of `size` (`***` carries both bold and italic). */
function runFits(length: number, size: 1 | 2): boolean {
	return size === 2 ? length >= 2 : length === 1 || length === 3;
}

/**
 * The marker inside a run. Bold sits next to the content and italic on the outside,
 * matching how `***x***` renders (italic around bold).
 */
function markerIn(run: Span, size: 1 | 2, opening: boolean): Span {
	if (size === 2) return opening ? { from: run.to - 2, to: run.to } : { from: run.from, to: run.from + 2 };
	return opening ? { from: run.from, to: run.from + 1 } : { from: run.to - 1, to: run.to };
}

/**
 * Pairs of markers of one character and size on one line, in line offsets. A run of marker
 * characters can open when followed by non-space and close when preceded by non-space;
 * underscores inside words (snake_case) never count, and runs inside code or links are ignored.
 */
function markerPairs(text: string, char: string, size: 1 | 2, opaque: readonly Span[]): MarkerPair[] {
	const pairs: MarkerPair[] = [];
	let pending: Span | null = null;
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] !== char) {
			i++;
			continue;
		}
		let end = i;
		while (text[end] === char) end++;
		const run = { from: i, to: end };
		i = end;
		if (!runFits(run.to - run.from, size) || opaque.some((s) => overlaps(s, run))) continue;
		const before = text[run.from - 1];
		const after = text[run.to];
		let canOpen = after !== undefined && !/\s/.test(after);
		let canClose = before !== undefined && !/\s/.test(before);
		if (char === "_") {
			canOpen &&= before === undefined || !WORD_CHAR.test(before);
			canClose &&= after === undefined || !WORD_CHAR.test(after);
		}
		if (pending && canClose) {
			pairs.push({ open: markerIn(pending, size, true), close: markerIn(run, size, false) });
			pending = null;
		} else if (canOpen) {
			pending = run;
		}
	}
	return pairs;
}

/** Maps an offset through ascending changes. `assoc` picks a side when text is inserted exactly at `pos`. */
export function mapPos(pos: number, changes: readonly TextChange[], assoc: -1 | 1): number {
	let delta = 0;
	for (const c of changes) {
		const before = c.to < pos || (c.to === pos && (c.from < pos || assoc > 0));
		if (before) {
			delta += c.insert.length - (c.to - c.from);
		} else if (c.from < pos && pos < c.to) {
			return c.from + delta + (assoc > 0 ? c.insert.length : 0);
		} else {
			break;
		}
	}
	return pos + delta;
}

const remove = (span: Span, base: number): TextChange => ({ from: span.from + base, to: span.to + base, insert: "" });

/**
 * Plans toggling bold, italic, or highlight on a single-line target:
 * - already formatted (exactly, with its markers selected, or as part of a larger span) → remove that span's markers;
 * - straddling the edge of an existing span → refused, since any edit would leave broken markers;
 * - otherwise wrap it, merging any spans it fully contains.
 */
export function planFormat(doc: DocLike, target: Span, kind: FormatKind): FormatPlan {
	const spec = SPECS[kind];
	const line = doc.lineAt(target.from);
	if (target.to > line.to) return { ok: false, reason: REASON.multiline };
	const base = line.from;
	const f = target.from - base;
	const t = target.to - base;
	if (f >= t) return { ok: false, reason: "Nothing to format" };

	const code = inlineCodeSpans(line.text);
	const opaque = [...code, ...linkSpans(line.text, code)];
	const pairs = spec.chars
		.flatMap((char) => markerPairs(line.text, char, spec.size, opaque))
		.sort((a, b) => a.open.from - b.open.from);

	for (const pair of pairs) {
		const selectedWithMarkers = pair.open.from === f && pair.close.to === t;
		const insideContent = pair.open.to <= f && t <= pair.close.from;
		if (selectedWithMarkers || insideContent) {
			const changes = [remove(pair.open, base), remove(pair.close, base)];
			return {
				ok: true,
				active: true,
				changes,
				selection: { from: mapPos(target.from, changes, 1), to: mapPos(target.to, changes, -1) },
			};
		}
	}

	const range = { from: f, to: t };
	const inner: MarkerPair[] = [];
	for (const pair of pairs) {
		const outer = { from: pair.open.from, to: pair.close.to };
		if (!overlaps(outer, range)) continue;
		if (!containsSpan(range, outer)) return { ok: false, reason: `Overlaps existing ${spec.label}` };
		inner.push(pair);
	}

	const changes: TextChange[] = [
		{ from: target.from, to: target.from, insert: spec.wrap },
		...inner.flatMap((pair) => [remove(pair.open, base), remove(pair.close, base)]),
		{ from: target.to, to: target.to, insert: spec.wrap },
	];
	return {
		ok: true,
		active: false,
		changes,
		selection: { from: mapPos(target.from, changes, 1), to: mapPos(target.to, changes, -1) },
	};
}

/**
 * Plans toggling a custom wrapper (e.g. `%%` … `%%`, `<u>` … `</u>`) around a single-line target.
 * Unwraps when the target includes the wrapper or sits directly between it; otherwise wraps.
 */
export function planWrap(doc: DocLike, target: Span, before: string, after: string): FormatPlan {
	if (!before && !after) return { ok: false, reason: "This wrapper is empty" };
	const line = doc.lineAt(target.from);
	if (target.to > line.to) return { ok: false, reason: REASON.multiline };
	if (target.from >= target.to) return { ok: false, reason: "Nothing to format" };
	const text = doc.sliceString(target.from, target.to);
	const finish = (active: boolean, changes: TextChange[]): FormatPlan => ({
		ok: true,
		active,
		changes,
		selection: { from: mapPos(target.from, changes, 1), to: mapPos(target.to, changes, -1) },
	});

	if (text.length > before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
		const inner = { from: target.from + before.length, to: target.to - after.length };
		const changes = [
			{ from: target.from, to: inner.from, insert: "" },
			{ from: inner.to, to: target.to, insert: "" },
		].filter((c) => c.from < c.to);
		return { ok: true, active: true, changes, selection: { from: target.from, to: inner.to - before.length } };
	}
	const pre = doc.sliceString(Math.max(line.from, target.from - before.length), target.from);
	const post = doc.sliceString(target.to, Math.min(line.to, target.to + after.length));
	if (pre === before && post === after) {
		return finish(
			true,
			[
				{ from: target.from - before.length, to: target.from, insert: "" },
				{ from: target.to, to: target.to + after.length, insert: "" },
			].filter((c) => c.from < c.to),
		);
	}
	return finish(false, [
		{ from: target.from, to: target.from, insert: before },
		{ from: target.to, to: target.to, insert: after },
	]);
}
