import { describe, expect, it } from "vitest";
import { linkAt } from "../src/text/links";
import { at } from "./helpers";

const linkUnder = (text: string, needle: string) => linkAt(text, at(text, needle));

describe("linkAt", () => {
	it("parses a plain wikilink", () => {
		const s = "see [[Tuberculosis]] here";
		expect(linkUnder(s, "Tuber")).toEqual({
			from: 4,
			to: 20,
			kind: "wiki",
			target: "Tuberculosis",
			subpath: "",
			alias: null,
			display: "Tuberculosis",
			external: false,
		});
	});

	it("parses aliases, headings, and folders", () => {
		expect(linkUnder("a [[Tuberculosis|TB]] b", "TB")).toMatchObject({ target: "Tuberculosis", alias: "TB", display: "TB" });
		expect(linkUnder("a [[Paper X#Methods]] b", "Methods")).toMatchObject({ target: "Paper X", subpath: "#Methods", display: "Paper X" });
		expect(linkUnder("a [[Projects/Apple]] b", "Apple")).toMatchObject({ target: "Projects/Apple", display: "Apple" });
		expect(linkUnder("a [[#Local heading]] b", "Local")).toMatchObject({ target: "", subpath: "#Local heading", display: "Local heading" });
	});

	it("understands the escaped pipe used inside tables", () => {
		expect(linkUnder("| [[Apple\\|kiwi]] | tart |", "kiwi")).toMatchObject({ target: "Apple", alias: "kiwi", display: "kiwi" });
	});

	it("recognises embeds", () => {
		expect(linkUnder("![[diagram.png]]", "diagram")).toMatchObject({ kind: "embed", target: "diagram.png" });
	});

	it("parses markdown links, internal and external", () => {
		expect(linkUnder("[the docs](https://obsidian.md/help) x", "docs")).toMatchObject({
			kind: "markdown",
			target: "https://obsidian.md/help",
			display: "the docs",
			external: true,
		});
		expect(linkUnder("[TB](Notes/Tuberculosis%20overview.md#Cause) x", "TB")).toMatchObject({
			target: "Notes/Tuberculosis overview.md",
			subpath: "#Cause",
			display: "TB",
			external: false,
		});
		expect(linkUnder("[x](<My note.md>)", "x")).toMatchObject({ target: "My note.md" });
	});

	it("returns null outside links and inside inline code", () => {
		expect(linkUnder("see [[Note]] here", "here")).toBeNull();
		expect(linkUnder("code `[[Note]]` here", "Note")).toBeNull();
	});
});
