import { describe, expect, it } from "vitest";
import { REASON } from "../src/text/reasons";
import { resolveTarget } from "../src/text/target";
import { at, spanOf, toDoc } from "./helpers";

describe("resolveTarget", () => {
	it("uses the word under the pointer when nothing is selected", () => {
		const s = "hello world";
		expect(resolveTarget(toDoc(s), at(s, "orl"), [])).toMatchObject({ text: "world", source: "word", blocked: null });
	});

	it("returns null over whitespace or punctuation", () => {
		expect(resolveTarget(toDoc("hello, world"), 5, [])).toBeNull();
		expect(resolveTarget(toDoc("hello world"), 5, [])).toBeNull();
		expect(resolveTarget(toDoc("hi"), 99, [])).toBeNull();
	});

	it("prefers a selection that contains the hovered character", () => {
		const s = "the graph view panel";
		const selection = spanOf(s, "graph view");
		expect(resolveTarget(toDoc(s), at(s, "view"), [selection])).toMatchObject({
			text: "graph view",
			source: "selection",
			...selection,
		});
	});

	it("falls back to the word when hovering outside the selection", () => {
		const s = "the graph view panel";
		expect(resolveTarget(toDoc(s), at(s, "panel"), [spanOf(s, "graph view")])).toMatchObject({
			text: "panel",
			source: "word",
		});
	});

	it("ignores empty selections (a plain cursor)", () => {
		const s = "hello world";
		expect(resolveTarget(toDoc(s), 1, [{ from: 1, to: 1 }])).toMatchObject({ text: "hello", source: "word" });
	});

	it("trims whitespace around a selection and ignores whitespace-only selections", () => {
		const s = "a  hello  b";
		expect(resolveTarget(toDoc(s), at(s, "ello"), [{ from: 1, to: 10 }])).toMatchObject({ text: "hello", from: 3, to: 8 });
		expect(resolveTarget(toDoc(s), 1, [{ from: 1, to: 3 }])).toBeNull();
	});

	it("blocks multiline selections", () => {
		const target = resolveTarget(toDoc("one\ntwo"), 1, [{ from: 0, to: 7 }]);
		expect(target).toMatchObject({ blocked: REASON.multiline, source: "selection" });
		expect(target?.bold.ok).toBe(false);
		expect(target?.highlight.ok).toBe(false);
		expect(target?.link.ok).toBe(false);
	});

	it("allows a selection that ends at a line break", () => {
		const s = "one\ntwo";
		expect(resolveTarget(toDoc(s), 1, [{ from: 0, to: 4 }])).toMatchObject({ text: "one", blocked: null });
	});

	it("blocks code, links, and tags", () => {
		const cases: Array<[string, string, string]> = [
			["run `npm test` now", "test", REASON.inlineCode],
			["see [[Graph view]] now", "Graph", REASON.link],
			["filed under #inbox", "inbox", REASON.tag],
			["```\ncode\n```", "code", REASON.codeBlock],
		];
		for (const [s, needle, reason] of cases) {
			const target = resolveTarget(toDoc(s), at(s, needle), []);
			expect(target, s).toMatchObject({ blocked: reason });
			expect(target?.bold.ok, s).toBe(false);
		}
	});

	it("applies an extra (syntax-tree) check", () => {
		const s = "inline $x$ math";
		const target = resolveTarget(toDoc(s), at(s, "x"), [], () => REASON.math);
		expect(target).toMatchObject({ blocked: REASON.math });
	});

	it("exposes bold, italic, and highlight state for the menu", () => {
		const s = "a **bold** and ==marked== and *slanted* word";
		expect(resolveTarget(toDoc(s), at(s, "old"), [])?.bold).toMatchObject({ ok: true, active: true });
		expect(resolveTarget(toDoc(s), at(s, "old"), [])?.italic).toMatchObject({ ok: true, active: false });
		expect(resolveTarget(toDoc(s), at(s, "old"), [])?.highlight).toMatchObject({ ok: true, active: false });
		expect(resolveTarget(toDoc(s), at(s, "ark"), [])?.highlight).toMatchObject({ ok: true, active: true });
		expect(resolveTarget(toDoc(s), at(s, "lant"), [])?.italic).toMatchObject({ ok: true, active: true });
	});

	it("reports the link a word sits in, so the wheel can offer link tools", () => {
		const s = "see [[Tuberculosis|TB]] now";
		const target = resolveTarget(toDoc(s), at(s, "TB"), []);
		expect(target?.blocked).toBe(REASON.link);
		expect(target?.existingLink).toMatchObject({ target: "Tuberculosis", display: "TB", docFrom: 4, docTo: 23 });
		expect(resolveTarget(toDoc(s), at(s, "now"), [])?.existingLink).toBeNull();
	});

	it("does not report a link for a selection that only partly covers it", () => {
		const s = "see [[Tuberculosis]] now";
		expect(resolveTarget(toDoc(s), at(s, "see"), [{ from: 0, to: 10 }])?.existingLink).toBeNull();
	});

	it("allows extracting any selected passage, including several lines, but not single words", () => {
		const s = "First line of a finding.\nSecond line with `code` and [[Link]].";
		expect(resolveTarget(toDoc(s), 2, [{ from: 0, to: s.length }])?.extract).toEqual({
			ok: true,
			from: 0,
			to: s.length,
			text: s,
		});
		expect(resolveTarget(toDoc(s), 2, [])?.extract.ok).toBe(false);
		const fm = "---\ntitle: x\n---\nbody";
		expect(resolveTarget(toDoc(fm), at(fm, "title"), [{ from: 4, to: 12 }])?.extract.ok).toBe(false);
	});

	it("allows look-ups in code and links, but not across lines", () => {
		const s = "run `npm test` and see [[Graph view]]";
		expect(resolveTarget(toDoc(s), at(s, "test"), [])?.lookup).toEqual({ ok: true, term: "test" });
		expect(resolveTarget(toDoc(s), at(s, "Graph"), [])?.lookup).toEqual({ ok: true, term: "Graph" });
		expect(resolveTarget(toDoc("one\ntwo"), 1, [{ from: 0, to: 7 }])?.lookup.ok).toBe(false);
		const marked = "a **bold claim** b";
		expect(resolveTarget(toDoc(marked), at(marked, "claim"), [{ from: 2, to: 16 }])?.lookup).toEqual({ ok: true, term: "bold claim" });
	});

	it("plans strikethrough like the other toggles", () => {
		const s = "an ~~old~~ claim";
		expect(resolveTarget(toDoc(s), at(s, "old"), [])?.strikethrough).toMatchObject({ ok: true, active: true });
	});

	it("refuses italic too when the target is blocked", () => {
		const s = "run `npm test` now";
		expect(resolveTarget(toDoc(s), at(s, "test"), [])?.italic.ok).toBe(false);
	});

	it("links the text inside formatting that wraps the whole selection", () => {
		const s = "a **word** b";
		const target = resolveTarget(toDoc(s), at(s, "word"), [spanOf(s, "**word**")]);
		expect(target?.link).toEqual({ ok: true, text: "word", ...spanOf(s, "word") });
		const nested = "x ***both*** y";
		expect(resolveTarget(toDoc(nested), at(nested, "both"), [spanOf(nested, "***both***")])?.link).toMatchObject({
			text: "both",
		});
	});

	it("does not strip markers that belong to separate spans", () => {
		const s = "**a** and **b**";
		expect(resolveTarget(toDoc(s), at(s, "and"), [{ from: 0, to: s.length }])?.link).toMatchObject({
			ok: true,
			text: s,
		});
	});

	it("refuses to link text containing brackets or pipes, but still allows bold", () => {
		const s = "a [b] c";
		const target = resolveTarget(toDoc(s), 0, [{ from: 0, to: s.length }]);
		expect(target?.link).toEqual({ ok: false, reason: REASON.linkChars });
		expect(target?.bold.ok).toBe(true);
	});
});
