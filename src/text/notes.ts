/** A note as seen by the picker, independent of Obsidian's TFile so it can be tested. */
export interface NoteEntry {
	path: string;
	basename: string;
	aliases: readonly string[];
	mtime?: number;
}

export interface NoteMatch {
	note: NoteEntry;
	score: number;
	/** The alias that matched, when it scored better than the note's own name. */
	matchedAlias: string | null;
	/** Name or alias equals the query (ignoring case and repeated spaces). */
	exact: boolean;
}

export function normalizeName(s: string): string {
	return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isSubsequence(query: string, name: string): boolean {
	let i = 0;
	for (const ch of name) if (ch === query[i] && ++i === query.length) return true;
	return query.length === 0;
}

const EXACT = 100;

function scoreName(query: string, name: string): number {
	if (name === query) return EXACT;
	if (name.startsWith(query)) return 80;
	const at = name.indexOf(query);
	if (at > 0) return /[\s\-_./]/.test(name[at - 1]) ? 65 : 50;
	if (isSubsequence(query.replace(/ /g, ""), name)) return 20;
	return 0;
}

/**
 * Ranks notes for a query: exact name or alias first, then prefix, word-start, substring,
 * and finally loose in-order character matches. An empty query lists recently modified notes.
 */
export function rankNotes(query: string, notes: readonly NoteEntry[], limit = 50): NoteMatch[] {
	const q = normalizeName(query);
	if (!q) {
		return [...notes]
			.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
			.slice(0, limit)
			.map((note) => ({ note, score: 0, matchedAlias: null, exact: false }));
	}
	const matches: NoteMatch[] = [];
	for (const note of notes) {
		let score = scoreName(q, normalizeName(note.basename));
		let matchedAlias: string | null = null;
		for (const alias of note.aliases) {
			// Ties go to the note's own name.
			const aliasScore = scoreName(q, normalizeName(alias)) - 1;
			if (aliasScore > score) {
				score = aliasScore;
				matchedAlias = alias;
			}
		}
		if (score <= 0 && normalizeName(note.path).includes(q)) score = 10;
		if (score > 0) matches.push({ note, score, matchedAlias, exact: score >= EXACT - 1 });
	}
	return matches
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.note.basename.length - b.note.basename.length ||
				a.note.path.localeCompare(b.note.path),
		)
		.slice(0, limit);
}

/** How many notes share each (normalised) name; a count above one means paths are needed to tell them apart. */
export function nameCounts(notes: readonly NoteEntry[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const note of notes) {
		const key = normalizeName(note.basename);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

export function isAmbiguous(note: NoteEntry, counts: ReadonlyMap<string, number>): boolean {
	return (counts.get(normalizeName(note.basename)) ?? 0) > 1;
}

/** A filename-safe title suggested from the hovered text. */
export function suggestTitle(text: string): string {
	return text
		.replace(/[*=~`]+/g, "")
		.replace(/[\\/:?"<>|#^[\]]/g, " ")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[._\s]+|[._\s]+$/g, "");
}

export type TitleCheck = { ok: true; title: string } | { ok: false; reason: string };

const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Validates a new note's title (without extension) for Obsidian and for Windows, macOS, and Linux file systems. */
export function validateTitle(raw: string): TitleCheck {
	const title = raw.trim();
	if (!title) return { ok: false, reason: "Type a title for the new note" };
	const invalid = /[\\/:*?"<>|]/.exec(title);
	if (invalid) return { ok: false, reason: `“${invalid[0]}” can't be used in note names` };
	const linkBreaking = /[#^[\]]/.exec(title);
	if (linkBreaking) return { ok: false, reason: `“${linkBreaking[0]}” would break links to the note` };
	if (/[\u0000-\u001f\u007f]/.test(title)) return { ok: false, reason: "Title contains control characters" };
	if (title.startsWith(".")) return { ok: false, reason: "Note names can't start with a dot" };
	if (title.endsWith(".")) return { ok: false, reason: "Note names can't end with a dot" };
	if (RESERVED_WINDOWS_NAME.test(title)) return { ok: false, reason: `“${title}” is a reserved name on Windows` };
	if (title.length > 200) return { ok: false, reason: "Title is too long" };
	return { ok: true, title };
}

export type CreatePlan =
	| { ok: true; title: string; path: string; folder: string; sameNameElsewhere: string[] }
	| { ok: false; reason: string; existingPath?: string };

function basenameOf(path: string): string {
	const file = path.slice(path.lastIndexOf("/") + 1);
	return file.toLowerCase().endsWith(".md") ? file.slice(0, -3) : file;
}

const sameKey = (s: string) => s.normalize("NFC").toLowerCase();

/**
 * Plans creating `<folder>/<title>.md`. An existing file at that path (compared without case,
 * as on Windows and macOS) is a conflict; notes with the same name in other folders are
 * reported so the picker can warn before creating a second note with that name.
 */
export function planCreate(rawTitle: string, folderPath: string, existingPaths: Iterable<string>): CreatePlan {
	const check = validateTitle(rawTitle);
	if (!check.ok) return check;
	const folder = folderPath.replace(/^\/+|\/+$/g, "");
	const path = folder ? `${folder}/${check.title}.md` : `${check.title}.md`;
	const pathKey = sameKey(path);
	const nameKey = sameKey(check.title);
	const sameNameElsewhere: string[] = [];
	for (const existing of existingPaths) {
		if (sameKey(existing) === pathKey) {
			return { ok: false, reason: `“${existing}” already exists`, existingPath: existing };
		}
		if (/\.md$/i.test(existing) && sameKey(basenameOf(existing)) === nameKey) sameNameElsewhere.push(existing);
	}
	return { ok: true, title: check.title, path, folder, sameNameElsewhere };
}

/**
 * Whether linking `visibleText` to a note should offer to save it as one of the note's aliases:
 * only when it is a genuinely different name (not the title or an existing alias in another case).
 */
export function shouldOfferAlias(visibleText: string, basename: string, aliases: readonly string[]): boolean {
	const text = visibleText.trim();
	if (!text || text.length > 60 || /[\n[\]|#^]/.test(text)) return false;
	const key = normalizeName(text);
	return key !== normalizeName(basename) && !aliases.some((a) => normalizeName(a) === key);
}

const MAX_TITLE_WORDS = 8;

/** A short title for a note extracted from a passage: its first heading or the opening words of its first line. */
export function suggestTitleFromPassage(passage: string): string {
	const firstLine =
		passage
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	const cleaned = firstLine
		.replace(/^(?:>\s*)+/, "")
		.replace(/^#{1,6}\s+/, "")
		.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	const words = suggestTitle(cleaned).split(" ").filter(Boolean);
	const short = words.slice(0, MAX_TITLE_WORDS).join(" ");
	return short.replace(/[,;:.!?]+$/, "");
}
