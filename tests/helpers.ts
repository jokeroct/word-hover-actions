import { Text } from "@codemirror/state";
import type { TextChange } from "../src/text/format";

export const toDoc = (source: string): Text => Text.of(source.split("\n"));

/** Applies changes whose offsets all refer to the original text, as CodeMirror does. */
export function applyChanges(source: string, changes: readonly TextChange[]): string {
	let out = source;
	for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
		out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	}
	return out;
}

/** Offset of the first occurrence of `needle` (optionally the nth), failing loudly when absent. */
export function at(source: string, needle: string, nth = 0): number {
	let index = -1;
	for (let i = 0; i <= nth; i++) {
		index = source.indexOf(needle, index + 1);
		if (index < 0) throw new Error(`"${needle}" not found in "${source}"`);
	}
	return index;
}

export function spanOf(source: string, needle: string, nth = 0) {
	const from = at(source, needle, nth);
	return { from, to: from + needle.length };
}
