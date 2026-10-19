import { describe, expect, it } from "vitest";
import { aliasFor, escapeTablePipes, isTableRow } from "../src/text/links";
import {
	type NoteEntry,
	isAmbiguous,
	nameCounts,
	planCreate,
	rankNotes,
	shouldOfferAlias,
	suggestTitle,
	suggestTitleFromPassage,
	validateTitle,
} from "../src/text/notes";

const note = (path: string, aliases: string[] = [], mtime = 0): NoteEntry => ({
	path,
	basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
	aliases,
	mtime,
});

const NOTES = [
	note("Apple.md", [], 1),
	note("Projects/Apple.md", [], 5),
	note("Applesauce recipe.md", [], 3),
	note("Pineapple.md", [], 2),
	note("Banana bread.md", [], 4),
	note("Graph view.md", ["graph", "GV"]),
	note("Graph view tips.md"),
];

const paths = (query: string) => rankNotes(query, NOTES).map((m) => m.note.path);

describe("rankNotes", () => {
	it("ranks exact names first, then prefix, word-start, and substring matches", () => {
		expect(paths("apple")).toEqual(["Apple.md", "Projects/Apple.md", "Applesauce recipe.md", "Pineapple.md"]);
		expect(rankNotes("apple", NOTES).map((m) => m.exact)).toEqual([true, true, false, false]);
	});

	it("matches without regard to case or repeated spaces", () => {
		expect(rankNotes("graph   VIEW", NOTES)[0]).toMatchObject({ exact: true, note: { path: "Graph view.md" } });
	});

	it("matches aliases and reports which alias matched", () => {
		expect(rankNotes("gv", NOTES)[0]).toMatchObject({ exact: true, matchedAlias: "GV", note: { path: "Graph view.md" } });
	});

	it("prefers the note's own name over an alias that scores the same", () => {
		const [first] = rankNotes("graph view", NOTES);
		expect(first).toMatchObject({ matchedAlias: null, note: { path: "Graph view.md" } });
	});

	it("matches words inside names and loose in-order letters", () => {
		expect(paths("bread")).toEqual(["Banana bread.md"]);
		expect(paths("grvw")).toContain("Graph view.md");
		expect(paths("zzz")).toEqual([]);
	});

	it("matches folder paths as a last resort", () => {
		expect(paths("projects")).toEqual(["Projects/Apple.md"]);
	});

	it("lists recently modified notes for an empty query", () => {
		expect(paths("  ").slice(0, 3)).toEqual(["Projects/Apple.md", "Banana bread.md", "Applesauce recipe.md"]);
	});

	it("respects the limit", () => {
		expect(rankNotes("a", NOTES, 2)).toHaveLength(2);
	});
});

describe("ambiguous names", () => {
	it("flags notes whose name is shared by another note", () => {
		const counts = nameCounts(NOTES);
		expect(isAmbiguous(NOTES[0], counts)).toBe(true);
		expect(isAmbiguous(NOTES[1], counts)).toBe(true);
		expect(isAmbiguous(NOTES[4], counts)).toBe(false);
	});
});

describe("titles", () => {
	it("suggests a filename-safe title from the hovered text", () => {
		expect(suggestTitle("graph view")).toBe("graph view");
		expect(suggestTitle("**Graph view**")).toBe("Graph view");
		expect(suggestTitle("a/b: c?")).toBe("a b c");
		expect(suggestTitle("C#")).toBe("C");
		expect(suggestTitle("  .hidden.  ")).toBe("hidden");
		expect(suggestTitle("_italic_")).toBe("italic");
	});

	it("validates titles", () => {
		expect(validateTitle("  Normal title ")).toEqual({ ok: true, title: "Normal title" });
		expect(validateTitle("café notes")).toMatchObject({ ok: true });
		const rejected = ["", "   ", "a:b", "a/b", "a\\b", 'say "hi"', "a#b", "a^b", "a[b]", ".hidden", "trailing.", "CON", "lpt1", "x".repeat(201)];
		for (const title of rejected) expect(validateTitle(title).ok, title).toBe(false);
		expect(validateTitle("a:b")).toEqual({ ok: false, reason: "“:” can't be used in note names" });
	});
});

describe("planCreate", () => {
	const existing = ["Apple.md", "Projects/Apple.md", "Inbox/Banana.md", "Inbox/Images", "Inbox/photo.png"];

	it("builds the path inside the new-note folder", () => {
		expect(planCreate("Cherry", "Inbox", existing)).toEqual({
			ok: true,
			title: "Cherry",
			path: "Inbox/Cherry.md",
			folder: "Inbox",
			sameNameElsewhere: [],
		});
		expect(planCreate("Cherry", "/", existing)).toMatchObject({ ok: true, path: "Cherry.md", folder: "" });
	});

	it("refuses an existing path, ignoring case", () => {
		expect(planCreate("banana", "Inbox", existing)).toMatchObject({ ok: false, existingPath: "Inbox/Banana.md" });
		expect(planCreate("APPLE", "/", existing)).toMatchObject({ ok: false, existingPath: "Apple.md" });
	});

	it("warns about notes with the same name in other folders", () => {
		expect(planCreate("Apple", "Inbox", existing)).toMatchObject({
			ok: true,
			path: "Inbox/Apple.md",
			sameNameElsewhere: ["Apple.md", "Projects/Apple.md"],
		});
	});

	it("does not count non-note files with a similar name", () => {
		expect(planCreate("photo", "Inbox", existing)).toMatchObject({ ok: true, sameNameElsewhere: [] });
	});

	it("passes through validation errors", () => {
		expect(planCreate("a|b", "Inbox", existing)).toMatchObject({ ok: false });
		expect(planCreate("a|b", "Inbox", existing)).not.toHaveProperty("existingPath");
	});
});

describe("link text", () => {
	it("adds an alias only when the visible wording differs from the link text", () => {
		expect(aliasFor("Apple", "Apple")).toBeUndefined();
		expect(aliasFor("apple", "Apple")).toBe("apple");
		expect(aliasFor("Apple", "Projects/Apple")).toBe("Apple");
	});

	it("escapes pipes inside table rows", () => {
		expect(isTableRow("| a | b |")).toBe(true);
		expect(isTableRow("plain | text")).toBe(false);
		expect(escapeTablePipes("[[Apple|apple]]")).toBe("[[Apple\\|apple]]");
		expect(escapeTablePipes("[[Apple\\|apple]]")).toBe("[[Apple\\|apple]]");
	});
});

describe("shouldOfferAlias", () => {
	it("offers genuinely different wording", () => {
		expect(shouldOfferAlias("TB", "Tuberculosis", [])).toBe(true);
		expect(shouldOfferAlias("Mango", "Mango smoothie", ["smoothie"])).toBe(true);
	});

	it("skips the note's own name and existing aliases, in any case", () => {
		expect(shouldOfferAlias("tuberculosis", "Tuberculosis", [])).toBe(false);
		expect(shouldOfferAlias("tb", "Tuberculosis", ["TB"])).toBe(false);
	});

	it("skips empty, very long, or link-breaking text", () => {
		expect(shouldOfferAlias("  ", "X", [])).toBe(false);
		expect(shouldOfferAlias("x".repeat(61), "X", [])).toBe(false);
		expect(shouldOfferAlias("a|b", "X", [])).toBe(false);
	});
});

describe("suggestTitleFromPassage", () => {
	it("uses the opening words of the first non-empty line", () => {
		expect(suggestTitleFromPassage("\n\nIsoniazid resistance rose sharply in the cohort between 2019 and 2023.")).toBe(
			"Isoniazid resistance rose sharply in the cohort between",
		);
	});

	it("strips heading, list, quote, and task markers", () => {
		expect(suggestTitleFromPassage("## Key findings\nmore")).toBe("Key findings");
		expect(suggestTitleFromPassage("> - [ ] Follow up on: sputum results")).toBe("Follow up on sputum results");
		expect(suggestTitleFromPassage("1. First point.")).toBe("First point");
	});

	it("keeps link text but drops link syntax", () => {
		expect(suggestTitleFromPassage("[[Tuberculosis|TB]] spreads via [aerosols](x.md)")).toBe("TB spreads via aerosols");
	});
});
