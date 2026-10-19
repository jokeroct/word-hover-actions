import { describe, expect, it } from "vitest";
import { noteFromPassage, noteFromSummary, parseWikipediaSummary, parseWiktionary } from "../src/text/lookup";

const strip = (html: string) => html.replace(/<[^>]*>/g, "");

const WIKI = {
	type: "standard",
	title: "Tuberculosis",
	description: "Infectious disease",
	extract: "Tuberculosis (TB) is an infectious disease usually caused by Mycobacterium tuberculosis bacteria.",
	content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Tuberculosis" } },
};

describe("parseWikipediaSummary", () => {
	it("reads title, description, extract, and page URL", () => {
		expect(parseWikipediaSummary(WIKI)).toEqual({
			title: "Tuberculosis",
			description: "Infectious disease",
			extract: WIKI.extract,
			url: "https://en.wikipedia.org/wiki/Tuberculosis",
			disambiguation: false,
		});
	});

	it("flags disambiguation pages and tolerates a missing description", () => {
		expect(parseWikipediaSummary({ ...WIKI, type: "disambiguation", description: undefined })).toMatchObject({
			disambiguation: true,
			description: null,
		});
	});

	it("returns null for error responses and empty extracts", () => {
		expect(parseWikipediaSummary(null)).toBeNull();
		expect(parseWikipediaSummary({ type: "https://mediawiki.org/wiki/HyperSwitch/errors/not_found", title: "Not found." })).toBeNull();
		expect(parseWikipediaSummary({ ...WIKI, extract: "  " })).toBeNull();
	});
});

describe("parseWiktionary", () => {
	const json = {
		en: [
			{
				partOfSpeech: "Noun",
				language: "English",
				definitions: [
					{ definition: 'An <a href="/wiki/infectious">infectious</a> disease.' },
					{ definition: "" },
					{ definition: "<i>(archaic)</i> Consumption." },
					{ definition: "Third." },
					{ definition: "Fourth (dropped)." },
				],
			},
			{ partOfSpeech: "Adjective", definitions: [] },
		],
		fr: [{ partOfSpeech: "Nom", definitions: [{ definition: "Maladie." }] }],
	};

	it("returns plain-text definitions for the chosen language, capped per entry", () => {
		expect(parseWiktionary(json, "en", strip)).toEqual([
			{ partOfSpeech: "Noun", definitions: ["An infectious disease.", "(archaic) Consumption.", "Third."] },
		]);
		expect(parseWiktionary(json, "fr", strip)).toEqual([{ partOfSpeech: "Nom", definitions: ["Maladie."] }]);
	});

	it("returns nothing for missing languages or malformed data", () => {
		expect(parseWiktionary(json, "de", strip)).toEqual([]);
		expect(parseWiktionary("nope", "en", strip)).toEqual([]);
	});
});

describe("note templates", () => {
	it("puts the source URL in a property above the summary", () => {
		const summary = parseWikipediaSummary(WIKI)!;
		expect(noteFromSummary(summary)).toBe(
			`---\nsource: "https://en.wikipedia.org/wiki/Tuberculosis"\n---\n\n*Infectious disease*\n\n${WIKI.extract}\n`,
		);
	});

	it("links an extracted passage back to its source note", () => {
		expect(noteFromPassage("A finding.", "Papers/Smith 2021")).toBe('---\nsource: "[[Papers/Smith 2021]]"\n---\n\nA finding.\n');
	});
});
