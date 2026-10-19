import { inlineCodeSpans } from "./context";

/** The display alias needed so a link keeps the hovered wording; undefined when the link text already matches. */
export function aliasFor(visibleText: string, linktext: string): string | undefined {
	return visibleText === linktext ? undefined : visibleText;
}

/** Rough check for a markdown table row, where a bare `|` would split the cell. */
export function isTableRow(lineText: string): boolean {
	const t = lineText.trim();
	return t.startsWith("|") && t.indexOf("|", 1) > 0;
}

/** Escapes `|` inside a generated link so `[[Note|alias]]` survives inside a table cell. */
export function escapeTablePipes(link: string): string {
	return link.replace(/(?<!\\)\|/g, "\\|");
}

/** An existing link on one line, in line offsets. */
export interface LinkInfo {
	from: number;
	to: number;
	kind: "wiki" | "embed" | "markdown";
	/** Note path or name for internal links (without `#subpath`); the URL for external ones. */
	target: string;
	/** `#Heading` or `#^block`, or "". */
	subpath: string;
	alias: string | null;
	/** The text a reader sees, and what Unlink leaves behind. */
	display: string;
	external: boolean;
}

const WIKI_LINK = /(!?)\[\[([^[\]\n]*)\]\]/g;
const MARKDOWN_LINK =
	/(!?)\[((?:\\.|[^[\]\\\n])*)\]\(\s*(<[^<>\n]*>|(?:\\.|[^()\s\\]|\((?:\\.|[^()\s\\])*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function defaultDisplay(target: string, subpath: string): string {
	const name = target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/i, "");
	return name || subpath.replace(/^#\^?/, "").trim();
}

function splitSubpath(ref: string): { target: string; subpath: string } {
	const hash = ref.indexOf("#");
	return hash < 0 ? { target: ref.trim(), subpath: "" } : { target: ref.slice(0, hash).trim(), subpath: ref.slice(hash) };
}

function safeDecode(url: string): string {
	try {
		return decodeURI(url);
	} catch {
		return url;
	}
}

function parseWiki(m: RegExpExecArray): LinkInfo {
	const inner = m[2];
	// In tables the separator is written `\|`.
	const pipe = /\\?\|/.exec(inner);
	const ref = pipe ? inner.slice(0, pipe.index) : inner;
	const alias = pipe ? inner.slice(pipe.index + pipe[0].length).trim() || null : null;
	const { target, subpath } = splitSubpath(ref);
	return {
		from: m.index,
		to: m.index + m[0].length,
		kind: m[1] ? "embed" : "wiki",
		target,
		subpath,
		alias,
		display: alias ?? defaultDisplay(target, subpath),
		external: false,
	};
}

function parseMarkdown(m: RegExpExecArray): LinkInfo {
	const text = m[2].replace(/\\(.)/g, "$1");
	const raw = m[3].replace(/^<|>$/g, "");
	const external = URL_SCHEME.test(raw);
	const { target, subpath } = external ? { target: raw, subpath: "" } : splitSubpath(safeDecode(raw));
	return {
		from: m.index,
		to: m.index + m[0].length,
		kind: m[1] ? "embed" : "markdown",
		target,
		subpath,
		alias: text || null,
		display: text || defaultDisplay(target, subpath),
		external,
	};
}

/** The wikilink, embed, or markdown link covering `index` in a line, ignoring links inside inline code. */
export function linkAt(text: string, index: number): LinkInfo | null {
	const code = inlineCodeSpans(text);
	const inCode = (pos: number) => code.some((s) => s.from <= pos && pos < s.to);
	for (const [pattern, parse] of [
		[WIKI_LINK, parseWiki],
		[MARKDOWN_LINK, parseMarkdown],
	] as const) {
		pattern.lastIndex = 0;
		for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
			if (m.index <= index && index < m.index + m[0].length && !inCode(m.index)) return parse(m);
		}
	}
	return null;
}
