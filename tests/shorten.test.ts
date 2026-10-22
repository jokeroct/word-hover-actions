import { describe, expect, it } from "vitest";
import { REASON } from "../src/text/reasons";
import { paragraphAt, selectionPassage, shortenText, splitSentences } from "../src/text/shorten";
import { at, toDoc } from "./helpers";

const PARAGRAPH =
	"The first forms of life on Earth are thought to have been ==microorganisms== that existed for billions of years before plants and animals appeared. " +
	"The mammals, birds, and flowers so familiar to us are all relatively recent, originating 130 to 200 million years ago. " +
	"Humans have inhabited this planet for only the last 2.5 million years, and only in the last 300,000 years have humans started looking like we do today.";

describe("splitSentences", () => {
	const sentences = (text: string) => splitSentences(text).map((s) => text.slice(s.from, s.to).trim());

	it("splits prose into sentences", () => {
		expect(sentences("One thing happened. Then another! Did it?")).toEqual(["One thing happened.", "Then another!", "Did it?"]);
	});

	it("doesn't split after abbreviations or initials", () => {
		expect(sentences("Dr. Smith met J. Doe at the lab. They talked, e.g. about cells.")).toEqual([
			"Dr. Smith met J. Doe at the lab.",
			"They talked, e.g. about cells.",
		]);
	});

	it("doesn't split inside links, code, or math", () => {
		const text = "See [[Book.pdf#page=21|Book, p. 21]] first. Then run `a. b` and $x. y$ too.";
		expect(sentences(text)).toEqual(["See [[Book.pdf#page=21|Book, p. 21]] first.", "Then run `a. b` and $x. y$ too."]);
	});
});

describe("shortenText", () => {
	it("keeps about half, as whole sentences in their original order", () => {
		const short = shortenText(PARAGRAPH, 0.5);
		expect(short.length).toBeLessThan(PARAGRAPH.length * 0.75);
		expect(short.startsWith("The first forms of life")).toBe(true);
		const kept = splitSentences(short).map((s) => short.slice(s.from, s.to).trim());
		const original = splitSentences(PARAGRAPH).map((s) => PARAGRAPH.slice(s.from, s.to).trim());
		const positions = kept.map((k) => original.findIndex((o) => o.replace(/\s+/g, " ") === k || o.includes(k.slice(0, 20))));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("keeps less for a shorter length", () => {
		expect(shortenText(PARAGRAPH, 0.35).length).toBeLessThanOrEqual(shortenText(PARAGRAPH, 0.67).length);
	});

	it("keeps the formatting and links of the sentences it keeps", () => {
		expect(shortenText(PARAGRAPH, 0.5)).toContain("==microorganisms==");
		const linked = "Cells are the basic unit of [[life]]. Every organism is made of [[cell|cells]] that divide. Some are tiny. Others are large.";
		const short = shortenText(linked, 0.6);
		expect(short).toMatch(/\[\[life\]\]|\[\[cell\|cells\]\]/);
	});

	it("tightens wordy English phrasing, but not inside links or code", () => {
		expect(shortenText("In order to grow, cells really need energy due to the fact that division is costly.", 1)).toBe(
			"To grow, cells need energy because division is costly.",
		);
		expect(shortenText("Read [[in order to]] and `very fast` now.", 1)).toBe("Read [[in order to]] and `very fast` now.");
	});

	it("drops a linking word that opens a kept sentence", () => {
		expect(shortenText("However, the cell divides quickly.", 1)).toBe("The cell divides quickly.");
	});

	it("removes long asides in parentheses, but keeps references and short ones", () => {
		expect(shortenText("Cells divide (which is a process that takes some time) often.", 1)).toBe("Cells divide often.");
		expect(shortenText("Cells divide (Smith, 2019) often (TB).", 1)).toBe("Cells divide (Smith, 2019) often (TB).");
	});

	it("only tightens English, but still picks sentences in other languages", () => {
		expect(shortenText("In order to grow.", 1, "de")).toBe("In order to grow.");
	});
});

describe("paragraphAt", () => {
	it("takes the whole paragraph around a word, across soft line breaks", () => {
		const s = "Intro\n\nFirst line of a long paragraph about cells and their many parts,\ncontinued on a second line that adds more detail.\n\nNext";
		const plan = paragraphAt(toDoc(s), at(s, "cells"));
		expect(plan).toMatchObject({
			ok: true,
			from: at(s, "First"),
			to: at(s, "detail.") + "detail.".length,
			text: "First line of a long paragraph about cells and their many parts, continued on a second line that adds more detail.",
			prefix: "",
			separator: "\n\n",
		});
	});

	it("works inside nested quotes, such as PDF++ callouts, keeping the markers", () => {
		const s = `> [!PDF|] [[Book.pdf#page=21|Book, p.21]]\n> > ${PARAGRAPH}\n> \n> next`;
		const plan = paragraphAt(toDoc(s), at(s, "mammals"));
		expect(plan).toMatchObject({ ok: true, from: at(s, "The first"), text: PARAGRAPH, prefix: "> > " });
		if (plan.ok) {
			expect(plan.insertAt).toBe(at(s, "today.") + "today.".length);
			expect(plan.separator).toBe("\n> >\n> > ");
		}
	});

	it("treats a list item as its own passage", () => {
		const s = "- [x] A finished task about cells and energy and how the whole thing works in practice\n- next item";
		const plan = paragraphAt(toDoc(s), at(s, "energy"));
		expect(plan).toMatchObject({ ok: true, from: at(s, "A finished"), separator: "\n- [ ] " });
	});

	it("refuses headings, code, and short text", () => {
		expect(paragraphAt(toDoc("# A heading"), 3)).toMatchObject({ ok: false });
		expect(paragraphAt(toDoc("```\ncode line with plenty of words in it to shorten here now\n```"), 6)).toEqual({
			ok: false,
			reason: REASON.codeBlock,
		});
		expect(paragraphAt(toDoc("A short line."), 2)).toEqual({ ok: false, reason: "Too short to shorten" });
	});
});

describe("selectionPassage", () => {
	it("joins a selection over quote lines without their markers", () => {
		const s = "> > One sentence about cells and energy.\n> > Another sentence about how they divide and grow over time.";
		const span = { from: at(s, "One"), to: s.length };
		const plan = selectionPassage(toDoc(s), span);
		expect(plan).toMatchObject({
			ok: true,
			from: span.from,
			to: span.to,
			text: "One sentence about cells and energy. Another sentence about how they divide and grow over time.",
			prefix: "> > ",
			insertAt: s.length,
		});
	});
});
