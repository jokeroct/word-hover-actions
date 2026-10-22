import { type SlotAction, isBuiltin } from "./actions";
import { SHORTEN_RATIOS, type ShortenLength } from "./text/shorten";
import { type ColorPreset, isPreset } from "./theme";

export type SlotCount = 4 | 6 | 8;
export const SLOT_COUNTS: readonly SlotCount[] = [4, 6, 8];

/** A user-defined toggle that wraps the target in `before` … `after`. */
export interface CustomWrapper {
	id: string;
	name: string;
	icon: string;
	before: string;
	after: string;
}

export interface WordHoverSettings {
	/** How long the pointer rests on a word, with Shift held, before the wheel opens (ms). */
	openDelay: number;
	slotCount: SlotCount;
	/** Actions clockwise from the top, kept separately for each wheel size. */
	slots: Record<SlotCount, SlotAction[]>;
	customWrappers: CustomWrapper[];
	/** After linking, offer to link the other plain mentions of the same text in the note. */
	offerLinkAll: boolean;
	/** After linking with different wording, save that wording as an alias of the target note. */
	learnAliases: "ask" | "always" | "never";
	/** What replaces an extracted passage. */
	extractReplace: "link" | "embed";
	/** Wikipedia/Wiktionary language code. */
	lookupLanguage: string;
	/** How much of a passage Shorten keeps, to begin with. */
	shortenLength: ShortenLength;
	/** Built-in (offline: picks key sentences) or a local AI through Ollama (rewrites). */
	shortenEngine: "builtin" | "ollama";
	/** Ollama's address, contacted only when the engine is "ollama". */
	ollamaUrl: string;
	ollamaModel: string;
	/** Colors for the wheel, toast, and dialogs. */
	colorPreset: ColorPreset;
}

/** An http(s) address with a host, without a trailing slash. */
export function cleanUrl(value: string): string | null {
	const url = value.trim().replace(/\/+$/, "");
	return /^https?:\/\/[^\s/]+/i.test(url) ? url : null;
}

/** The range offered for the open delay, in milliseconds. */
export const OPEN_DELAY_RANGE = { min: 0, max: 500, step: 10 };

export const DEFAULT_SETTINGS: WordHoverSettings = {
	openDelay: 40,
	slotCount: 6,
	slots: {
		4: ["link", "bold", "highlight", "italic"],
		6: ["link", "bold", "highlight", "extract", "define", "italic"],
		8: ["link", "bold", "strikethrough", "highlight", "extract", "define", "custom:comment", "italic"],
	},
	customWrappers: [
		{ id: "comment", name: "Comment", icon: "message-square", before: "%%", after: "%%" },
		{ id: "math", name: "Math", icon: "sigma", before: "$", after: "$" },
	],
	offerLinkAll: true,
	learnAliases: "ask",
	extractReplace: "link",
	lookupLanguage: "en",
	shortenLength: "half",
	shortenEngine: "builtin",
	ollamaUrl: "http://localhost:11434",
	ollamaModel: "llama3.2",
	colorPreset: "accent",
};

/** Where each slot sits, for the settings tab. */
export function slotPositionNames(count: SlotCount): string[] {
	if (count === 4) return ["Top", "Right", "Bottom", "Left"];
	if (count === 6) return ["Top", "Upper right", "Lower right", "Bottom", "Lower left", "Upper left"];
	return ["Top", "Top right", "Right", "Bottom right", "Bottom", "Bottom left", "Left", "Top left"];
}

/** Merges saved data over the defaults, tolerating missing or outdated fields. */
export function loadSettings(saved: unknown): WordHoverSettings {
	const data = (typeof saved === "object" && saved !== null ? saved : {}) as Partial<WordHoverSettings>;
	const slotCount = SLOT_COUNTS.includes(data.slotCount as SlotCount) ? (data.slotCount as SlotCount) : DEFAULT_SETTINGS.slotCount;
	const slots = {} as Record<SlotCount, SlotAction[]>;
	for (const count of SLOT_COUNTS) {
		const list = data.slots?.[count];
		slots[count] = Array.isArray(list)
			? list.filter((v): v is SlotAction => typeof v === "string")
			: [...DEFAULT_SETTINGS.slots[count]];
	}
	const customWrappers = Array.isArray(data.customWrappers)
		? data.customWrappers.filter(
				(w): w is CustomWrapper =>
					typeof w === "object" && w !== null && typeof w.id === "string" && typeof w.before === "string" && typeof w.after === "string",
			)
		: DEFAULT_SETTINGS.customWrappers.map((w) => ({ ...w }));
	const delay = data.openDelay;
	return {
		openDelay:
			typeof delay === "number" && Number.isFinite(delay)
				? Math.min(OPEN_DELAY_RANGE.max, Math.max(OPEN_DELAY_RANGE.min, Math.round(delay)))
				: DEFAULT_SETTINGS.openDelay,
		slotCount,
		slots,
		customWrappers,
		offerLinkAll: typeof data.offerLinkAll === "boolean" ? data.offerLinkAll : DEFAULT_SETTINGS.offerLinkAll,
		learnAliases: ["ask", "always", "never"].includes(data.learnAliases as string)
			? (data.learnAliases as WordHoverSettings["learnAliases"])
			: DEFAULT_SETTINGS.learnAliases,
		extractReplace: data.extractReplace === "embed" ? "embed" : "link",
		lookupLanguage: /^[a-z]{2,3}(-[a-z]+)?$/i.test(data.lookupLanguage ?? "") ? data.lookupLanguage! : DEFAULT_SETTINGS.lookupLanguage,
		shortenLength: Object.prototype.hasOwnProperty.call(SHORTEN_RATIOS, data.shortenLength ?? "")
			? data.shortenLength!
			: DEFAULT_SETTINGS.shortenLength,
		shortenEngine: data.shortenEngine === "ollama" ? "ollama" : "builtin",
		ollamaUrl: cleanUrl(data.ollamaUrl ?? "") ?? DEFAULT_SETTINGS.ollamaUrl,
		ollamaModel: typeof data.ollamaModel === "string" && data.ollamaModel.trim() ? data.ollamaModel.trim() : DEFAULT_SETTINGS.ollamaModel,
		colorPreset: isPreset(data.colorPreset) ? data.colorPreset : DEFAULT_SETTINGS.colorPreset,
	};
}

/**
 * The actions for the current wheel size, exactly `slotCount` long. Unknown actions and
 * deleted custom wrappers become empty slots.
 */
export function resolveSlots(settings: WordHoverSettings): SlotAction[] {
	const wrappers = new Set(settings.customWrappers.map((w) => `custom:${w.id}`));
	const list = settings.slots[settings.slotCount] ?? [];
	return Array.from({ length: settings.slotCount }, (_, i): SlotAction => {
		const action = list[i];
		if (!action || action === "none") return "none";
		if (isBuiltin(action) || wrappers.has(action)) return action;
		return "none";
	});
}
