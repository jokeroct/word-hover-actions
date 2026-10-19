import { requestUrl } from "obsidian";
import { type DictionaryEntry, type WikiSummary, parseWikipediaSummary, parseWiktionary } from "./text/lookup";

// Wikimedia asks API clients to identify themselves; browsers may only set this header, not User-Agent.
const HEADERS = { "Api-User-Agent": "WordHoverActions/0.3 (personal Obsidian plugin)" };

async function getJson(url: string): Promise<unknown> {
	const response = await requestUrl({ url, headers: HEADERS, throw: false });
	if (response.status !== 200) return null;
	try {
		return response.json;
	} catch {
		return null;
	}
}

const pageName = (term: string) => encodeURIComponent(term.trim().replace(/ /g, "_"));

function htmlToText(html: string): string {
	return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

/** The Wikipedia summary for `term`, following redirects. Null when there is no such page. Throws when offline. */
export async function lookupWikipedia(term: string, language: string): Promise<WikiSummary | null> {
	return parseWikipediaSummary(await getJson(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${pageName(term)}?redirect=true`));
}

/**
 * Wiktionary definitions for `term` in `language`, trying the term as written and then in lower case
 * (Wiktionary titles are case-sensitive). Throws when offline.
 */
export async function lookupWiktionary(term: string, language: string): Promise<DictionaryEntry[]> {
	const candidates = [...new Set([term.trim(), term.trim().toLowerCase()])];
	for (const candidate of candidates) {
		const json = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${pageName(candidate)}`);
		const entries = parseWiktionary(json, language, htmlToText);
		if (entries.length > 0) return entries;
	}
	return [];
}

export function wikipediaSearchUrl(term: string, language: string): string {
	return `https://${language}.wikipedia.org/w/index.php?search=${encodeURIComponent(term)}`;
}

export function wiktionaryUrl(term: string): string {
	return `https://en.wiktionary.org/wiki/${pageName(term)}`;
}
