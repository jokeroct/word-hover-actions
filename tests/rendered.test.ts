import { describe, expect, it } from "vitest";
import { calloutMarkerEnd, locatePieces, quoteBlockAt, splitLines } from "../src/text/rendered";
import { at, toDoc } from "./helpers";

// A PDF++ highlight callout, as it sits in a note.
const CALLOUT = [
	"> [!PDF|] [[Concepts-Biology_-_WEB.pdf#page=21&selection=13,7,16,75|Concepts-Biology_-_WEB, p.21]]",
	"> > The first forms of life on Earth are thought to have been ==microorganisms== that existed for ==billions of years before== plants and animals appeared.",
	"> ",
	"> [!PDF|] [[Concepts-Biology_-_WEB.pdf#page=21&selection=36,0,37,1|Concepts-Biology_-_WEB, p.21]]",
	"> > **Biology**",
	"> > [!PDF|] [[Concepts-Biology_-_WEB.pdf#page=21&selection=38,0,38,33|Concepts-Biology_-_WEB, p.21]]",
	"> > is the science that studies [[life]].",
].join("\n");

// Its text as Live Preview renders it, one piece per text node, in reading order.
const PIECES = [
	"Concepts-Biology_-_WEB, p.21",
	"The first forms of life on Earth are thought to have been ",
	"microorganisms",
	" that existed for ",
	"billions of years before",
	" plants and animals appeared.",
	"[!PDF|] ",
	"Concepts-Biology_-_WEB, p.21",
	"Biology",
	"[!PDF|] ",
	"Concepts-Biology_-_WEB, p.21",
	"is the science that studies ",
	"life",
	".",
];

describe("locatePieces", () => {
	const located = locatePieces(CALLOUT, PIECES);

	it("finds every rendered piece of a PDF++ callout in its markdown", () => {
		expect(located.every((index) => index !== null)).toBe(true);
		located.forEach((index, i) => expect(CALLOUT.slice(index!, index! + PIECES[i].length)).toBe(PIECES[i]));
	});

	it("maps formatted and linked text inside the markers", () => {
		expect(located[2]).toBe(at(CALLOUT, "microorganisms=="));
		expect(located[12]).toBe(at(CALLOUT, "life]]"));
	});

	it("maps repeated text to the matching occurrence, past hidden link targets", () => {
		expect(located[0]).toBe(at(CALLOUT, "Concepts-Biology_-_WEB, p.21", 0));
		expect(located[7]).toBe(at(CALLOUT, "Concepts-Biology_-_WEB, p.21", 1));
		expect(located[10]).toBe(at(CALLOUT, "Concepts-Biology_-_WEB, p.21", 2));
	});

	it("keeps a word inside a longer piece in that piece, not an earlier match", () => {
		expect(located[1]! + PIECES[1].indexOf("life")).toBe(at(CALLOUT, "life on Earth"));
	});

	it("skips pieces that aren't in the source verbatim, without losing the ones after", () => {
		const source = "> a \\* b **bold** end";
		expect(locatePieces(source, ["a * b ", "bold", " end"])).toEqual([null, at(source, "bold"), at(source, " end")]);
	});

	it("ignores whitespace-only pieces", () => {
		expect(locatePieces("> one two", ["one", " ", "two"])).toEqual([2, null, 6]);
	});
});

describe("quoteBlockAt", () => {
	const source = ["Before", "", CALLOUT, "", "After"].join("\n");
	const doc = toDoc(source);

	it("covers the whole run of quote lines around a position", () => {
		const block = quoteBlockAt(doc, at(source, "microorganisms"));
		expect(block).toEqual({ from: at(source, "> [!PDF"), to: at(source, "[[life]].") + "[[life]].".length });
	});

	it("is null outside quotes", () => {
		expect(quoteBlockAt(doc, at(source, "After"))).toBeNull();
	});
});

describe("calloutMarkerEnd", () => {
	it("ends after the type and fold markers", () => {
		expect(calloutMarkerEnd("> [!PDF|] [[x]]")).toBe("> [!PDF|]".length);
		expect(calloutMarkerEnd("> > [!tip]- Title")).toBe("> > [!tip]-".length);
	});

	it("is 0 for a plain quote", () => {
		expect(calloutMarkerEnd("> just a quote")).toBe(0);
	});
});

describe("splitLines", () => {
	it("keeps each line's offset", () => {
		expect(splitLines("ab\ncd")).toEqual([
			{ text: "ab", offset: 0 },
			{ text: "cd", offset: 3 },
		]);
	});
});
