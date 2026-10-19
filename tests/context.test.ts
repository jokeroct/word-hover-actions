import { describe, expect, it } from "vitest";
import { blockKindAt, blockReason, inlineCodeSpans, reasonForNodeName } from "../src/text/context";
import { REASON } from "../src/text/reasons";
import { spanOf, toDoc } from "./helpers";

const reasonAt = (source: string, needle: string, nth = 0) => {
	const { from, to } = spanOf(source, needle, nth);
	return blockReason(toDoc(source), from, to);
};

describe("inline code", () => {
	it("finds single and multi-backtick spans and ignores unclosed ones", () => {
		expect(inlineCodeSpans("use `code` here")).toEqual([{ from: 4, to: 10 }]);
		expect(inlineCodeSpans("``a ` b`` x")).toEqual([{ from: 0, to: 9 }]);
		expect(inlineCodeSpans("a `b c")).toEqual([]);
	});

	it("blocks words inside inline code only", () => {
		const s = "use `code here` now";
		expect(reasonAt(s, "code")).toBe(REASON.inlineCode);
		expect(reasonAt(s, "here")).toBe(REASON.inlineCode);
		expect(reasonAt(s, "use")).toBeNull();
		expect(reasonAt(s, "now")).toBeNull();
	});

	it("treats a link inside inline code as code", () => {
		expect(reasonAt("see `[[Note]]` here", "Note")).toBe(REASON.inlineCode);
	});
});

describe("code and math blocks", () => {
	it("blocks fence lines and their contents, not text after the closing fence", () => {
		const doc = toDoc("before\n```js\nconst x = 1\n```\nafter");
		expect(blockKindAt(doc, 1)).toBeNull();
		expect(blockKindAt(doc, 2)).toBe("code");
		expect(blockKindAt(doc, 3)).toBe("code");
		expect(blockKindAt(doc, 4)).toBe("code");
		expect(blockKindAt(doc, 5)).toBeNull();
	});

	it("only closes a fence with the same character and at least the same length", () => {
		const doc = toDoc("~~~~\n```\nstill code\n~~~\nstill code\n~~~~\nout");
		expect(blockKindAt(doc, 3)).toBe("code");
		expect(blockKindAt(doc, 5)).toBe("code");
		expect(blockKindAt(doc, 7)).toBeNull();
	});

	it("handles fences inside blockquotes and lists", () => {
		const doc = toDoc("> ```\n> quoted code\n> ```\n- item\n  ```\n  listed code\n  ```\ntext");
		expect(blockKindAt(doc, 2)).toBe("code");
		expect(blockKindAt(doc, 4)).toBeNull();
		expect(blockKindAt(doc, 6)).toBe("code");
		expect(blockKindAt(doc, 8)).toBeNull();
	});

	it("does not mistake inline triple backticks for a fence", () => {
		const s = "```inline``` text\nnext line";
		expect(blockKindAt(toDoc(s), 2)).toBeNull();
		expect(reasonAt(s, "text")).toBeNull();
		expect(reasonAt(s, "inline")).toBe(REASON.inlineCode);
	});

	it("blocks $$ math blocks", () => {
		const s = "$$\nx + y\n$$\nafter";
		expect(reasonAt(s, "x")).toBe(REASON.math);
		expect(reasonAt(s, "after")).toBeNull();
		expect(reasonAt("$$ e = mc^2 $$\nafter", "after")).toBeNull();
	});
});

describe("frontmatter", () => {
	it("blocks properties but not the body", () => {
		const s = "---\ntitle: Hello\n---\nHello body";
		expect(reasonAt(s, "Hello")).toBe(REASON.frontmatter);
		expect(reasonAt(s, "body")).toBeNull();
	});

	it("ignores an unclosed or misplaced --- block", () => {
		expect(reasonAt("---\ntitle: Hello", "Hello")).toBeNull();
		expect(reasonAt("intro\n---\nword\n---", "word")).toBeNull();
	});

	it("does not treat code fences inside frontmatter as fences", () => {
		const s = "---\nnote: ```\n---\nbody";
		expect(reasonAt(s, "body")).toBeNull();
	});
});

describe("links and tags", () => {
	it("blocks wikilinks, aliases, and embeds", () => {
		const s = "see [[Note]] and [[Other|alias]] and ![[image.png]] end";
		expect(reasonAt(s, "Note")).toBe(REASON.link);
		expect(reasonAt(s, "alias")).toBe(REASON.link);
		expect(reasonAt(s, "image")).toBe(REASON.link);
		expect(reasonAt(s, "see")).toBeNull();
		expect(reasonAt(s, "and")).toBeNull();
		expect(reasonAt(s, "end")).toBeNull();
	});

	it("blocks markdown links, reference links, autolinks, and bare URLs", () => {
		const s = "a [text](https://x.com/a_(b)) bee [ref][1] cat <https://auto.link> dog https://example.com/path elk";
		expect(reasonAt(s, "text")).toBe(REASON.link);
		expect(reasonAt(s, "ref")).toBe(REASON.link);
		expect(reasonAt(s, "auto")).toBe(REASON.link);
		expect(reasonAt(s, "example")).toBe(REASON.link);
		for (const plain of ["bee", "cat", "dog", "elk"]) expect(reasonAt(s, plain)).toBeNull();
		expect(reasonAt("[x](<my file.md>) y", "file")).toBe(REASON.link);
	});

	it("leaves task checkboxes and plain brackets alone", () => {
		expect(reasonAt("- [ ] buy milk", "milk")).toBeNull();
		expect(reasonAt("- [x] done [[Link]]", "done")).toBeNull();
	});

	it("blocks tags but not headings, numbers, or # inside words", () => {
		expect(reasonAt("#project/alpha is", "project")).toBe(REASON.tag);
		expect(reasonAt("#project/alpha is", "alpha")).toBe(REASON.tag);
		expect(reasonAt("#project/alpha is", "is")).toBeNull();
		expect(reasonAt("# Heading", "Heading")).toBeNull();
		expect(reasonAt("issue #2024 fixed", "2024")).toBeNull();
		expect(reasonAt("learn C# today", "C")).toBeNull();
	});
});

describe("syntax node names", () => {
	it("maps Obsidian editor token names to reasons", () => {
		expect(reasonForNodeName("formatting-code_inline-code")).toBe(REASON.code);
		expect(reasonForNodeName("hmd-codeblock")).toBe(REASON.code);
		expect(reasonForNodeName("math")).toBe(REASON.math);
		expect(reasonForNodeName("hmd-internal-link")).toBe(REASON.link);
		expect(reasonForNodeName("string_url")).toBe(REASON.link);
		expect(reasonForNodeName("hashtag_hashtag-end")).toBe(REASON.tag);
		expect(reasonForNodeName("hmd-frontmatter")).toBe(REASON.frontmatter);
		for (const plain of ["Document", "strong", "em", "highlight", "header_header-1", "list-1", "quote_quote-1", "hmd-callout"]) {
			expect(reasonForNodeName(plain)).toBeNull();
		}
	});
});
