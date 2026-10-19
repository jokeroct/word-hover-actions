import type { Span } from "./spans";

const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
/** Characters that join two word characters into one word: don't, well-known, snake_case. */
export const JOINERS = new Set(["'", "’", "-", "_"]);

export interface CodePoint {
	cp: string;
	len: number;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

export function codePointAt(text: string, i: number): CodePoint | null {
	if (i < 0 || i >= text.length) return null;
	const cp = String.fromCodePoint(text.codePointAt(i)!);
	return { cp, len: cp.length };
}

export function codePointBefore(text: string, i: number): CodePoint | null {
	if (i <= 0 || i > text.length) return null;
	if (i >= 2 && isLowSurrogate(text.charCodeAt(i - 1)) && isHighSurrogate(text.charCodeAt(i - 2))) {
		return { cp: text.slice(i - 2, i), len: 2 };
	}
	return { cp: text[i - 1], len: 1 };
}

export function isWord(cp: CodePoint | null): boolean {
	return cp !== null && WORD_CHAR.test(cp.cp);
}

/**
 * Finds the word containing the character at `index` in `text`, or null when that
 * character is not part of a word (whitespace, punctuation, markdown markers).
 */
export function wordAt(text: string, index: number): Span | null {
	if (index > 0 && isLowSurrogate(text.charCodeAt(index)) && isHighSurrogate(text.charCodeAt(index - 1))) index--;
	const here = codePointAt(text, index);
	if (!here) return null;
	if (!isWord(here)) {
		const joinsWords =
			JOINERS.has(here.cp) && isWord(codePointBefore(text, index)) && isWord(codePointAt(text, index + here.len));
		if (!joinsWords) return null;
	}

	let from = index;
	let to = index + here.len;
	for (;;) {
		const before = codePointBefore(text, from);
		if (!before) break;
		if (isWord(before)) {
			from -= before.len;
			continue;
		}
		const beyond = JOINERS.has(before.cp) ? codePointBefore(text, from - before.len) : null;
		if (beyond && isWord(beyond)) {
			from -= before.len + beyond.len;
			continue;
		}
		break;
	}
	for (;;) {
		const after = codePointAt(text, to);
		if (!after) break;
		if (isWord(after)) {
			to += after.len;
			continue;
		}
		const beyond = JOINERS.has(after.cp) ? codePointAt(text, to + after.len) : null;
		if (beyond && isWord(beyond)) {
			to += after.len + beyond.len;
			continue;
		}
		break;
	}
	return { from, to };
}
