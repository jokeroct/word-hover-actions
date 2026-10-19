import { describe, expect, it } from "vitest";
import { findMentions } from "../src/text/mentions";
import { toDoc } from "./helpers";

const mentions = (source: string, term: string) => findMentions(toDoc(source), term).map((s) => source.slice(s.from, s.to));

describe("findMentions", () => {
	it("finds whole-word mentions in any letter case", () => {
		expect(mentions("TB is common. Treat tb early; TB!", "TB")).toEqual(["TB", "tb", "TB"]);
	});

	it("ignores mentions glued to other words, the same way hovering treats them as one word", () => {
		expect(mentions("TBS and TB-related and pre-TB and TB_data and TB's", "TB")).toEqual([]);
	});

	it("accepts punctuation around a mention", () => {
		expect(mentions("(TB), TB. “TB” and TB:", "TB")).toEqual(["TB", "TB", "TB", "TB"]);
	});

	it("matches multi-word terms across any run of spaces", () => {
		expect(mentions("the Graph view and graph   view, not graphview", "graph view")).toEqual(["Graph view", "graph   view"]);
	});

	it("skips existing links, code, tags, frontmatter, and code blocks", () => {
		const source = [
			"---",
			"topic: TB",
			"---",
			"TB here, [[TB]] linked, [TB](x.md) linked, `TB` code, #TB tag.",
			"```",
			"TB in code",
			"```",
			"$$",
			"TB math",
			"$$",
			"last TB",
		].join("\n");
		expect(mentions(source, "TB")).toEqual(["TB", "TB"]);
		expect(findMentions(toDoc(source), "TB").map((s) => toDoc(source).lineAt(s.from).number)).toEqual([4, 11]);
	});

	it("handles regex characters and non-ASCII text", () => {
		expect(mentions("C++ (and C++) rule", "C++")).toEqual(["C++", "C++"]);
		expect(mentions("Mycobacterium tuberculosis — MYCOBACTERIUM TUBERCULOSIS", "mycobacterium tuberculosis")).toHaveLength(2);
		expect(mentions("क्षयरोग और क्षयरोग", "क्षयरोग")).toHaveLength(2);
	});

	it("returns nothing for an empty term", () => {
		expect(mentions("anything", "  ")).toEqual([]);
	});
});
