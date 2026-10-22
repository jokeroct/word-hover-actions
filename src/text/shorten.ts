import { blockKindAt, frontmatterEnd } from "./context";
import { REASON } from "./reasons";
import type { DocLike, Span } from "./spans";

export type ShortenLength = "third" | "half" | "twoThirds";

/** Roughly how much of the original each length keeps. */
export const SHORTEN_RATIOS: Record<ShortenLength, number> = { third: 0.35, half: 0.5, twoThirds: 0.67 };

/** A passage of prose to shorten, and how to write a shortened version back into its block. */
export interface Passage extends Span {
	/** The passage as prose: quote markers removed and its lines joined. */
	text: string;
	/** Starts each further line of a replacement, e.g. "> > " inside a nested quote. */
	prefix: string;
	/** Where "Insert below" puts the shortened copy: the end of the passage's last line. */
	insertAt: number;
	/** Goes before the inserted copy, starting a new paragraph (or list item) in the same block. */
	separator: string;
}

export type ShortenPlan = ({ ok: true } & Passage) | { ok: false; reason: string };

const MIN_WORDS = 12;
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)*/;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/;
/** Lines that aren't prose: headings, callout markers, table rows, rules, fences. */
const NOT_PROSE = /^(?:#{1,6}(?:[ \t]|$)|\[![^\]]*\]|\||(?:[-*_][ \t]*){3,}$|```|~~~|\$\$)/;

interface LineInfo {
	kind: "blank" | "prose" | "list" | "other";
	/** Quote markers at the start of the line, e.g. "> > ". */
	quote: string;
	depth: number;
	/** List marker after the quote markers, e.g. "- " or "1. " or "- [ ] ". */
	marker: string;
	rest: string;
}

function lineInfo(text: string): LineInfo {
	const quote = QUOTE_PREFIX.exec(text)?.[0] ?? "";
	const rest = text.slice(quote.length);
	const depth = (quote.match(/>/g) ?? []).length;
	const marker = LIST_MARKER.exec(rest)?.[0] ?? "";
	const trimmed = rest.trim();
	const kind = !trimmed ? "blank" : NOT_PROSE.test(trimmed) ? "other" : marker ? "list" : "prose";
	return { kind, quote, depth, marker, rest };
}

/** Quote markers to start a new line in the same block, with the space Markdown expects. */
const linePrefix = (quote: string) => (quote && !/[ \t]$/.test(quote) ? `${quote} ` : quote);

const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/** Why lines in this range can't be shortened (properties, code, math), or null. */
function blockedLines(doc: DocLike, fromLine: number, toLine: number): string | null {
	const fmEnd = frontmatterEnd(doc);
	for (let n = fromLine; n <= toLine; n++) {
		if (fmEnd > 0 && n <= fmEnd) return REASON.frontmatter;
		const kind = blockKindAt(doc, n, fmEnd);
		if (kind === "code") return REASON.codeBlock;
		if (kind === "math") return REASON.math;
	}
	return null;
}

function plan(passage: Passage): ShortenPlan {
	if (wordCount(passage.text) < MIN_WORDS) return { ok: false, reason: "Too short to shorten" };
	return { ok: true, ...passage };
}

/**
 * The paragraph around `pos`: neighbouring prose lines at the same quote depth, or a single list
 * item. Inside a quote or callout, the quote markers stay where they are.
 */
export function paragraphAt(doc: DocLike, pos: number): ShortenPlan {
	const line = doc.lineAt(pos);
	const blocked = blockedLines(doc, line.number, line.number);
	if (blocked) return { ok: false, reason: blocked };
	const info = lineInfo(line.text);
	if (info.kind === "blank" || info.kind === "other") return { ok: false, reason: "Not part of a paragraph" };
	const prefix = linePrefix(info.quote);

	if (info.kind === "list") {
		const from = line.from + info.quote.length + info.marker.length;
		const to = line.from + line.text.trimEnd().length;
		const bullet = info.marker.replace(/\[.\]/, "[ ]");
		return plan({ from, to, text: doc.sliceString(from, to).trim(), prefix, insertAt: to, separator: `\n${prefix}${bullet}` });
	}

	const sameParagraph = (n: number) => {
		const other = lineInfo(doc.line(n).text);
		return other.kind === "prose" && other.depth === info.depth && !blockedLines(doc, n, n);
	};
	let first = line.number;
	let last = line.number;
	while (first > 1 && sameParagraph(first - 1)) first--;
	while (last < doc.lines && sameParagraph(last + 1)) last++;

	const lines = Array.from({ length: last - first + 1 }, (_, i) => doc.line(first + i));
	const firstInfo = lineInfo(lines[0].text);
	const from = lines[0].from + firstInfo.quote.length + (firstInfo.rest.length - firstInfo.rest.trimStart().length);
	const lastLine = lines[lines.length - 1];
	const to = lastLine.from + lastLine.text.trimEnd().length;
	const text = lines.map((l) => lineInfo(l.text).rest.trim()).join(" ");
	const separator = prefix ? `\n${prefix.trimEnd()}\n${prefix}` : "\n\n";
	return plan({ from, to, text, prefix, insertAt: lastLine.to, separator });
}

/** A selected passage, which may run over several lines of a quote or callout. */
export function selectionPassage(doc: DocLike, span: Span): ShortenPlan {
	const firstLine = doc.lineAt(span.from);
	const lastLine = doc.lineAt(span.to);
	const blocked = blockedLines(doc, firstLine.number, lastLine.number);
	if (blocked) return { ok: false, reason: blocked };
	const parts: string[] = [];
	for (let n = firstLine.number; n <= lastLine.number; n++) {
		const line = doc.line(n);
		const start = Math.max(span.from, line.from);
		const end = Math.min(span.to, line.to);
		let text = doc.sliceString(start, end);
		if (start === line.from) text = text.slice((QUOTE_PREFIX.exec(text)?.[0] ?? "").length);
		if (text.trim()) parts.push(text.trim());
	}
	const prefix = linePrefix(lineInfo(firstLine.text).quote);
	const separator = prefix ? `\n${prefix.trimEnd()}\n${prefix}` : "\n\n";
	return plan({ from: span.from, to: span.to, text: parts.join(" "), prefix, insertAt: lastLine.to, separator });
}

// ---- Shortening ---------------------------------------------------------------------------

/** Markup that stays intact: links, embeds, inline code and math, URLs. Sentence breaks and edits never fall inside. */
const PROTECTED = /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`|\$[^$\n]+\$|https?:\/\/\S+/g;

/** The same text with protected markup blanked out, so offsets still match. */
function masked(text: string): string {
	return text.replace(PROTECTED, (m) => "x".repeat(m.length));
}

/** Words ending a segment that don't end a sentence: "Dr.", "e.g.", "Fig.", initials such as "J.". */
const ABBREVIATION = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|cf|al|Fig|fig|No|Vol|vol|pp?|ca|approx|e\.g|i\.e)|\b\p{Lu})\.\s*$/u;

function segmenter(language: string): Intl.Segmenter {
	try {
		return new Intl.Segmenter(language, { granularity: "sentence" });
	} catch {
		return new Intl.Segmenter("en", { granularity: "sentence" });
	}
}

/** Sentences of `text`, as spans that include their trailing whitespace. */
export function splitSentences(text: string, language = "en"): Span[] {
	const spans: Span[] = [];
	for (const { segment, index } of segmenter(language).segment(masked(text))) {
		const previous = spans[spans.length - 1];
		if (previous && ABBREVIATION.test(text.slice(previous.from, previous.to))) previous.to = index + segment.length;
		else spans.push({ from: index, to: index + segment.length });
	}
	return spans;
}

const STOPWORDS = new Set(
	(
		"a an the and or but if then than so as of at by for from in into on onto to with without about above after again against all " +
		"also am are be been being before below between both can could did do does doing down during each few further had has have " +
		"having he her here hers him his how i is it its itself just me more most my no nor not now off once only other our out over " +
		"own same she should some such that their them there these they this those through too under until up very was we were what " +
		"when where which while who whom why will would you your"
	).split(" "),
);

/** Visible words of Markdown text, lower-cased: link aliases kept, targets and markers dropped. */
function words(text: string): string[] {
	const visible = text
		.replace(/!?\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
		.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");
	return (visible.toLowerCase().match(/[\p{L}\p{N}]+(?:['’]\p{L}+)?/gu) ?? []).map((w) => w.replace(/['’]s$/, ""));
}

/** A rough English stem, so "cells" and "cell" or "living" and "live" count as one word. */
function stem(word: string): string {
	if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
	if (word.length > 5 && /(?:ing|ed)$/.test(word)) return word.replace(/(?:ing|ed)$/, "");
	if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
	if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

const contentWords = (text: string) => words(text).filter((w) => (w.length > 2 || /\d/.test(w)) && !STOPWORDS.has(w)).map(stem);

/**
 * How central a sentence is: its content words weighted by how often they recur in the passage,
 * with a lift for the opening sentence, for text the writer marked (==highlight==, **bold**), for
 * figures, and for definitions, and a cut for fragments such as a lone bold heading.
 */
function sentenceScores(sentences: readonly string[]): number[] {
	const frequency = new Map<string, number>();
	const sets = sentences.map((s) => new Set(contentWords(s)));
	for (const set of sets) for (const w of set) frequency.set(w, (frequency.get(w) ?? 0) + 1);
	return sentences.map((sentence, i) => {
		const set = sets[i];
		let score = 0;
		for (const w of set) score += frequency.get(w) ?? 0;
		score /= (set.size || 1) ** 0.7;
		if (i === 0) score *= 1.25;
		if (EXAMPLE.test(sentence)) score *= 0.7;
		if (/==[^=]+==|\*\*[^*]+\*\*/.test(sentence)) score *= 1.3;
		if (/\d/.test(sentence)) score *= 1.1;
		if (/\b(?:is|are|means|refers to|is called|are called|defined as)\b/i.test(sentence)) score *= 1.1;
		if (words(sentence).length < 5) score *= 0.5;
		return score;
	});
}

/** Sentences that give an example, which a summary can usually do without. */
const EXAMPLE = /^(?:for (?:example|instance)|e\.g\.)/i;

/** Wordy phrases and their plain versions, applied outside links and code. */
const PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bin order to\b/gi, "to"],
	[/\b(?:due to|owing to) the fact that\b/gi, "because"],
	[/\b(?:in spite of|despite) the fact that\b/gi, "although"],
	[/\bat (?:this point in time|the present time)\b/gi, "now"],
	[/\bin the event that\b/gi, "if"],
	[/\bfor the purpose of\b/gi, "for"],
	[/\bwith (?:regard|respect) to\b/gi, "about"],
	[/\bprior to\b/gi, "before"],
	[/\bsubsequent to\b/gi, "after"],
	[/\ba (?:large|great) number of\b/gi, "many"],
	[/\bthe (?:vast )?majority of\b/gi, "most"],
	[/\b(?:is|are) able to\b/gi, "can"],
	[/\b(?:has|have) the ability to\b/gi, "can"],
	[/\bit (?:is important to note|should be noted|is worth noting|turns out) that\s+/gi, ""],
	[/\b(?:needless to say|as a matter of fact),?\s+/gi, ""],
	[/\b(?:very|really|actually|basically|essentially|literally)\s+/gi, ""],
	// Long asides in parentheses, but not ones with figures (years, references) or markup.
	[/\s*\((?![^)]*[\d[\]`$])(?:[^()\s]+\s+){5,}[^()\s]+\)/g, ""],
];

/** Linking words that open a sentence and may no longer fit once sentences around it are gone. */
const OPENERS =
	/^(?:however|moreover|furthermore|additionally|in addition|also|therefore|thus|consequently|as a result|in fact|indeed|of course|firstly|secondly|finally|overall|similarly|likewise|for example|for instance|in other words|nevertheless|nonetheless)\s*,\s*/i;

/** Replaces `pattern` in `text`, except inside protected markup. */
function replaceOutside(text: string, pattern: RegExp, replacement: string): string {
	const mask = masked(text);
	let out = "";
	let last = 0;
	for (const match of mask.matchAll(pattern)) {
		const at = match.index ?? 0;
		out += text.slice(last, at) + replacement;
		last = at + match[0].length;
	}
	return out + text.slice(last);
}

/** Tightens one English sentence without changing its meaning. */
function tighten(sentence: string): string {
	const capital = /^\p{Lu}/u.test(sentence);
	let out = sentence.replace(OPENERS, "");
	for (const [pattern, replacement] of PHRASES) out = replaceOutside(out, pattern, replacement);
	out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
	if (capital) out = out.replace(/^(\P{L}*)(\p{Ll})/u, (_m, lead: string, letter: string) => lead + letter.toUpperCase());
	return out;
}

/**
 * Shortens prose without leaving the computer: keeps the most central sentences, in their
 * original order, until about `ratio` of the text remains, then tightens wordy phrasing (English
 * only). Words are never invented, and links, code, and formatting stay intact.
 */
export function shortenText(text: string, ratio: number, language = "en"): string {
	const source = text.trim();
	const sentences = splitSentences(source, language).map((s) => source.slice(s.from, s.to).trim()).filter(Boolean);
	const budget = source.length * ratio;
	let kept = sentences;
	if (sentences.length > 1) {
		const scores = sentenceScores(sentences);
		const order = sentences.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
		const chosen = new Set<number>();
		let length = 0;
		// Most central first, each taken only if it brings the length closer to the target.
		for (const i of order) {
			const size = sentences[i].length + 1;
			if (chosen.size === 0 || Math.abs(length + size - budget) < Math.abs(length - budget)) {
				chosen.add(i);
				length += size;
			}
		}
		kept = sentences.filter((_, i) => chosen.has(i));
	}
	const english = language.toLowerCase().startsWith("en");
	return kept.map((s) => (english ? tighten(s) : s)).join(" ");
}
