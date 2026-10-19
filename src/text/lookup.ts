/** A Wikipedia page summary, as shown in the Define card. */
export interface WikiSummary {
	title: string;
	description: string | null;
	extract: string;
	url: string;
	/** The term has several meanings; the extract lists them rather than defining one. */
	disambiguation: boolean;
}

export interface DictionaryEntry {
	partOfSpeech: string;
	definitions: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Parses Wikipedia's REST `page/summary` response. Returns null for missing pages or empty extracts. */
export function parseWikipediaSummary(json: unknown): WikiSummary | null {
	if (!isRecord(json)) return null;
	const title = asString(json.title);
	const extract = asString(json.extract);
	const urls = isRecord(json.content_urls) && isRecord(json.content_urls.desktop) ? json.content_urls.desktop : null;
	const url = asString(urls?.page);
	if (!title || !extract || !url) return null;
	return {
		title,
		description: asString(json.description),
		extract,
		url,
		disambiguation: json.type === "disambiguation",
	};
}

/**
 * Parses Wiktionary's REST `page/definition` response for one language. Definitions arrive as
 * HTML; `toText` turns each into plain text (the plugin uses the DOM; tests use a simple stripper).
 */
export function parseWiktionary(
	json: unknown,
	language: string,
	toText: (html: string) => string,
	maxEntries = 3,
	maxDefinitions = 3,
): DictionaryEntry[] {
	if (!isRecord(json)) return [];
	const entries = json[language];
	if (!Array.isArray(entries)) return [];
	const result: DictionaryEntry[] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || !Array.isArray(entry.definitions)) continue;
		const definitions = entry.definitions
			.map((d) => (isRecord(d) ? asString(d.definition) : null))
			.filter((d): d is string => d !== null)
			.map((html) => toText(html).replace(/\s+/g, " ").trim())
			.filter((d) => d.length > 0)
			.slice(0, maxDefinitions);
		if (definitions.length === 0) continue;
		result.push({ partOfSpeech: asString(entry.partOfSpeech) ?? "Definition", definitions });
		if (result.length >= maxEntries) break;
	}
	return result;
}

/** Contents for a note created from a Wikipedia summary, with its source as a property. */
export function noteFromSummary(summary: WikiSummary): string {
	const lines = ["---", `source: ${JSON.stringify(summary.url)}`, "---", ""];
	if (summary.description) lines.push(`*${summary.description}*`, "");
	lines.push(summary.extract, "");
	return lines.join("\n");
}

/** Contents for a note extracted from a passage, linking back to the note it came from. */
export function noteFromPassage(passage: string, sourceLinktext: string): string {
	return ["---", `source: ${JSON.stringify(`[[${sourceLinktext}]]`)}`, "---", "", passage, ""].join("\n");
}
