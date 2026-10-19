import { describe, expect, it } from "vitest";
import { wordAt } from "../src/text/word";

const word = (text: string, index: number) => {
	const span = wordAt(text, index);
	return span && text.slice(span.from, span.to);
};

describe("wordAt", () => {
	it("finds the word under any of its characters", () => {
		expect(word("hello world", 0)).toBe("hello");
		expect(word("hello world", 4)).toBe("hello");
		expect(word("hello world", 6)).toBe("world");
		expect(word("hello world", 10)).toBe("world");
	});

	it("returns null for whitespace, punctuation, and out-of-range indexes", () => {
		expect(word("hello world", 5)).toBeNull();
		expect(word("a, b", 1)).toBeNull();
		expect(word("...", 1)).toBeNull();
		expect(word("abc", 3)).toBeNull();
		expect(word("abc", -1)).toBeNull();
		expect(word("", 0)).toBeNull();
	});

	it("keeps hyphens, apostrophes, and underscores that join word characters", () => {
		expect(word("a well-known fact", 3)).toBe("well-known");
		expect(word("a well-known fact", 6)).toBe("well-known"); // on the hyphen itself
		expect(word("don't stop", 1)).toBe("don't");
		expect(word("it’s fine", 0)).toBe("it’s");
		expect(word("call snake_case_name now", 8)).toBe("snake_case_name");
	});

	it("drops joiners at word edges and doubled joiners", () => {
		expect(word("end- of", 1)).toBe("end");
		expect(word("students' work", 2)).toBe("students");
		expect(word("a--b", 0)).toBe("a");
		expect(word("a--b", 1)).toBeNull();
	});

	it("excludes markdown markers around the word", () => {
		expect(word("**bold** text", 3)).toBe("bold");
		expect(word("_italic_", 3)).toBe("italic");
		expect(word("==mark==", 4)).toBe("mark");
		expect(word("[[Note]]", 3)).toBe("Note");
	});

	it("handles non-ASCII letters, combining marks, digits, and astral characters", () => {
		expect(word("café au lait", 3)).toBe("café");
		expect(word("नमस्ते दुनिया", 2)).toBe("नमस्ते");
		expect(word("the 2024 report", 5)).toBe("2024");
		expect(word("𝐀𝐁 c", 0)).toBe("𝐀𝐁");
		expect(word("𝐀𝐁 c", 1)).toBe("𝐀𝐁"); // index inside a surrogate pair
	});
});
