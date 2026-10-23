import { describe, expect, it } from "vitest";
import { type FormatKind, mapPos, planFormat, planFormatLines, planWrap } from "../src/text/format";
import { applyChanges, spanOf, toDoc } from "./helpers";

function toggle(source: string, needle: string, kind: FormatKind = "bold", nth = 0) {
	const plan = planFormat(toDoc(source), spanOf(source, needle, nth), kind);
	if (!plan.ok) return { ok: false as const, reason: plan.reason };
	const result = applyChanges(source, plan.changes);
	return {
		ok: true as const,
		active: plan.active,
		result,
		selected: result.slice(plan.selection.from, plan.selection.to),
	};
}

describe("bold", () => {
	it("wraps a plain word and reports the new selection inside the markers", () => {
		expect(toggle("hello world", "world")).toEqual({ ok: true, active: false, result: "hello **world**", selected: "world" });
	});

	it("removes bold from an already bold word", () => {
		expect(toggle("hello **world**", "world")).toEqual({ ok: true, active: true, result: "hello world", selected: "world" });
	});

	it("removes bold when the markers themselves are selected", () => {
		expect(toggle("hello **world**", "**world**")).toEqual({ ok: true, active: true, result: "hello world", selected: "world" });
	});

	it("removes the enclosing span when the target is part of a bold phrase", () => {
		expect(toggle("**hello world** after", "world")).toMatchObject({ active: true, result: "hello world after" });
	});

	it("keeps italics when removing bold from bold-italic, and adds bold to italics", () => {
		expect(toggle("***word***", "word")).toMatchObject({ active: true, result: "*word*" });
		expect(toggle("*word*", "word")).toMatchObject({ active: false, result: "***word***" });
	});

	it("recognises __underscore__ bold", () => {
		expect(toggle("an __old__ style", "old")).toMatchObject({ active: true, result: "an old style" });
	});

	it("refuses a target straddling the edge of existing bold", () => {
		expect(toggle("**hello** world", "lo** wor")).toEqual({ ok: false, reason: "Overlaps existing bold" });
	});

	it("merges bold spans that the target fully contains", () => {
		expect(toggle("a **b** c", "a **b** c")).toMatchObject({ active: false, result: "**a b c**", selected: "a b c" });
		expect(toggle("**a** b", "**a** b")).toMatchObject({ active: false, result: "**a b**", selected: "a b" });
	});

	it("ignores markers inside inline code and links", () => {
		expect(toggle("`**x**` word", "word")).toMatchObject({ active: false, result: "`**x**` **word**" });
		expect(toggle("[[a**b]] c**d", "c")).toMatchObject({ active: false });
	});

	it("does not pair markers that are surrounded by spaces", () => {
		expect(toggle("2 ** 3 and ** x", "and")).toMatchObject({ active: false, result: "2 ** 3 **and** ** x" });
	});

	it("works on lines after the first", () => {
		expect(toggle("first line\nsecond word here", "word")).toMatchObject({ result: "first line\nsecond **word** here" });
	});

	it("round-trips: toggling twice restores the original", () => {
		for (const [source, needle] of [
			["plain word", "word"],
			["a **b** c", "b"],
			["*italic* x", "italic"],
			["tail word", "tail word"],
		] as const) {
			const once = toggle(source, needle);
			if (!once.ok) throw new Error(once.reason);
			const twice = toggle(once.result, once.selected);
			expect(twice).toMatchObject({ ok: true, result: source });
		}
	});
});

describe("italic", () => {
	it("wraps a plain word with single asterisks and removes them again", () => {
		expect(toggle("an easy win", "easy", "italic")).toEqual({ ok: true, active: false, result: "an *easy* win", selected: "easy" });
		expect(toggle("an *easy* win", "easy", "italic")).toMatchObject({ active: true, result: "an easy win" });
		expect(toggle("an *easy* win", "*easy*", "italic")).toMatchObject({ active: true, result: "an easy win", selected: "easy" });
	});

	it("recognises _underscore_ italics but not underscores inside words", () => {
		expect(toggle("an _old_ style", "old", "italic")).toMatchObject({ active: true, result: "an old style" });
		expect(toggle("call snake_case_name now", "snake_case_name", "italic")).toMatchObject({
			active: false,
			result: "call *snake_case_name* now",
		});
	});

	it("does not mistake bold markers for italics", () => {
		expect(toggle("**word**", "word", "italic")).toMatchObject({ active: false, result: "***word***" });
		expect(toggle("**word**", "word", "bold")).toMatchObject({ active: true, result: "word" });
	});

	it("removes only the italic part of bold-italic", () => {
		expect(toggle("***word***", "word", "italic")).toMatchObject({ active: true, result: "**word**" });
	});

	it("handles italics around bold and bold around italics", () => {
		expect(toggle("*a **b** c*", "b", "italic")).toMatchObject({ active: true, result: "a **b** c" });
		expect(toggle("*a **b** c*", "b", "bold")).toMatchObject({ active: true, result: "*a b c*" });
		expect(toggle("**a *b* c**", "b", "italic")).toMatchObject({ active: true, result: "**a b c**" });
	});

	it("ignores list bullets and multiplication signs", () => {
		expect(toggle("* item here", "item", "italic")).toMatchObject({ active: false, result: "* *item* here" });
		expect(toggle("2 * 3 equals six", "six", "italic")).toMatchObject({ active: false, result: "2 * 3 equals *six*" });
	});

	it("round-trips: toggling twice restores the original", () => {
		for (const [source, needle] of [
			["plain word", "word"],
			["**bold** word", "bold"],
			["***both*** x", "both"],
		] as const) {
			const once = toggle(source, needle, "italic");
			if (!once.ok) throw new Error(once.reason);
			expect(toggle(once.result, once.selected, "italic")).toMatchObject({ ok: true, result: source });
		}
	});
});

describe("highlight", () => {
	it("wraps and unwraps with ==", () => {
		expect(toggle("mark this", "mark", "highlight")).toMatchObject({ active: false, result: "==mark== this" });
		expect(toggle("==mark== this", "mark", "highlight")).toMatchObject({ active: true, result: "mark this" });
		expect(toggle("==a long phrase== x", "long", "highlight")).toMatchObject({ active: true, result: "a long phrase x" });
	});

	it("is independent of bold", () => {
		expect(toggle("**word**", "word", "highlight")).toMatchObject({ active: false, result: "**==word==**" });
		expect(toggle("==word==", "word", "bold")).toMatchObject({ active: false, result: "==**word**==" });
	});

	it("ignores comparison operators", () => {
		expect(toggle("if a == b then", "then", "highlight")).toMatchObject({ active: false, result: "if a == b ==then==" });
	});
});

describe("mapPos", () => {
	const changes = [
		{ from: 2, to: 2, insert: "**" },
		{ from: 5, to: 7, insert: "" },
		{ from: 9, to: 9, insert: "**" },
	];
	it("maps positions through insertions and deletions", () => {
		expect(mapPos(0, changes, 1)).toBe(0);
		expect(mapPos(2, changes, 1)).toBe(4);
		expect(mapPos(2, changes, -1)).toBe(2);
		expect(mapPos(6, changes, -1)).toBe(7);
		expect(mapPos(9, changes, -1)).toBe(9);
		expect(mapPos(9, changes, 1)).toBe(11);
	});
});

describe("strikethrough", () => {
	it("wraps and unwraps with ~~", () => {
		expect(toggle("old claim", "old", "strikethrough")).toMatchObject({ active: false, result: "~~old~~ claim" });
		expect(toggle("~~old claim~~ x", "claim", "strikethrough")).toMatchObject({ active: true, result: "old claim x" });
	});
});

describe("planWrap (custom wrappers)", () => {
	const wrap = (source: string, needle: string, before: string, after: string) => {
		const plan = planWrap(toDoc(source), spanOf(source, needle), before, after);
		if (!plan.ok) return { ok: false as const, reason: plan.reason };
		const result = applyChanges(source, plan.changes);
		return { ok: true as const, active: plan.active, result, selected: result.slice(plan.selection.from, plan.selection.to) };
	};

	it("wraps the target", () => {
		expect(wrap("a note here", "note", "%%", "%%")).toEqual({ ok: true, active: false, result: "a %%note%% here", selected: "note" });
		expect(wrap("a note here", "note", "<u>", "</u>")).toMatchObject({ result: "a <u>note</u> here" });
	});

	it("unwraps when the wrapper sits right around the target", () => {
		expect(wrap("a %%note%% here", "note", "%%", "%%")).toEqual({ ok: true, active: true, result: "a note here", selected: "note" });
		expect(wrap("a <u>note</u> here", "note", "<u>", "</u>")).toMatchObject({ active: true, result: "a note here" });
	});

	it("unwraps when the wrapper is part of the selection", () => {
		expect(wrap("a $x+1$ b", "$x+1$", "$", "$")).toEqual({ ok: true, active: true, result: "a x+1 b", selected: "x+1" });
	});

	it("refuses an empty wrapper", () => {
		expect(wrap("a b", "a", "", "")).toMatchObject({ ok: false });
	});

	it("works at the very start and end of a line", () => {
		expect(wrap("note", "note", "%%", "%%")).toMatchObject({ result: "%%note%%" });
		expect(wrap("%%note%%", "note", "%%", "%%")).toMatchObject({ active: true, result: "note" });
	});
});

describe("planFormatLines (selections over several lines)", () => {
	function toggleLines(source: string, from: number, to: number, kind: FormatKind = "bold") {
		const doc = toDoc(source);
		const plan = planFormatLines(doc, { from, to }, (span) => planFormat(doc, span, kind));
		if (!plan.ok) return { ok: false as const, reason: plan.reason };
		const result = applyChanges(source, plan.changes);
		return { ok: true as const, active: plan.active, result, selected: result.slice(plan.selection.from, plan.selection.to) };
	}
	const all = (source: string) => [0, source.length] as const;

	it("formats each selected line on its own, skipping blank lines", () => {
		const s = "A. Monosaccharides (One Sugar)\n\nB. Disaccharides (Two Sugars)\n\nC. Polysaccharides (Many Sugars)";
		expect(toggleLines(s, ...all(s))).toMatchObject({
			ok: true,
			active: false,
			result: "**A. Monosaccharides (One Sugar)**\n\n**B. Disaccharides (Two Sugars)**\n\n**C. Polysaccharides (Many Sugars)**",
		});
	});

	it("removes the formatting when every line has it, and adds it to the others when only some do", () => {
		const bold = "**one**\n**two**";
		expect(toggleLines(bold, ...all(bold))).toMatchObject({ active: true, result: "one\ntwo" });
		const mixed = "**one**\ntwo";
		expect(toggleLines(mixed, ...all(mixed))).toMatchObject({ active: false, result: "**one**\n**two**" });
	});

	it("starts after list, task, heading, quote, and callout markers", () => {
		const s = "- item one\n- [ ] task two\n## Heading three\n> > quoted four\n> [!note] Title five";
		expect(toggleLines(s, ...all(s), "highlight")).toMatchObject({
			result: "- ==item one==\n- [ ] ==task two==\n## ==Heading three==\n> > ==quoted four==\n> [!note] ==Title five==",
		});
	});

	it("covers only the selected part of the first and last lines", () => {
		const s = "keep this start\nmiddle line\nthe end stays";
		expect(toggleLines(s, s.indexOf("start"), s.indexOf(" stays"))).toMatchObject({
			result: "keep this **start**\n**middle line**\n**the end** stays",
			selected: "**start**\n**middle line**\n**the end**",
		});
	});

	it("leaves a selection that toggles straight back", () => {
		const s = "A. One\n\nB. Two\n\nC. Three";
		const first = toggleLines(s, 0, s.length);
		if (!first.ok) throw new Error(first.reason);
		const from = first.result.indexOf(first.selected);
		const second = toggleLines(first.result, from, from + first.selected.length);
		expect(second).toMatchObject({ ok: true, active: true, result: s, selected: s });
	});

	it("leaves table rows and rules alone", () => {
		const s = "text\n| a | b |\n---\nmore";
		expect(toggleLines(s, ...all(s), "italic")).toMatchObject({ result: "*text*\n| a | b |\n---\n*more*" });
	});

	it("refuses when a line can't take the formatting, such as one starting halfway into bold text", () => {
		const s = "one **two** three\nnext line";
		expect(toggleLines(s, s.indexOf("wo"), s.length)).toEqual({ ok: false, reason: "Overlaps existing bold" });
	});

	it("works for custom wrappers too", () => {
		const doc = toDoc("one\ntwo");
		const plan = planFormatLines(doc, { from: 0, to: 7 }, (span) => planWrap(doc, span, "%%", "%%"));
		expect(plan.ok && applyChanges("one\ntwo", plan.changes)).toBe("%%one%%\n%%two%%");
	});
});
