import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, resolveSlots } from "../src/settings-model";
import { themeClasses } from "../src/theme";

describe("loadSettings", () => {
	it("uses the defaults when nothing is saved", () => {
		expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it("does not share arrays with the defaults", () => {
		const settings = loadSettings(undefined);
		settings.slots[4][0] = "none";
		settings.customWrappers.pop();
		expect(DEFAULT_SETTINGS.slots[4][0]).toBe("link");
		expect(DEFAULT_SETTINGS.customWrappers).toHaveLength(2);
	});

	it("keeps valid saved values and repairs invalid ones", () => {
		const settings = loadSettings({ slotCount: 8, learnAliases: "always", lookupLanguage: "de", extractReplace: "embed" });
		expect(settings).toMatchObject({ slotCount: 8, learnAliases: "always", lookupLanguage: "de", extractReplace: "embed" });
		expect(loadSettings({ slotCount: 5, learnAliases: "sometimes", lookupLanguage: "../evil" })).toMatchObject({
			slotCount: DEFAULT_SETTINGS.slotCount,
			learnAliases: "ask",
			lookupLanguage: "en",
		});
	});

	it("keeps the open delay within its range", () => {
		expect(loadSettings(null).openDelay).toBe(40);
		expect(loadSettings({ openDelay: 150 }).openDelay).toBe(150);
		expect(loadSettings({ openDelay: 9999 }).openDelay).toBe(500);
		expect(loadSettings({ openDelay: -5 }).openDelay).toBe(0);
		expect(loadSettings({ openDelay: "fast" }).openDelay).toBe(40);
	});

	it("keeps valid Shorten settings and repairs invalid ones", () => {
		expect(
			loadSettings({
				shortenLength: "third",
				shortenStyle: "numbered",
				shortenEngine: "ollama",
				ollamaUrl: "http://127.0.0.1:11434/",
				ollamaModel: " qwen2.5 ",
			}),
		).toMatchObject({
			shortenLength: "third",
			shortenStyle: "numbered",
			shortenEngine: "ollama",
			ollamaUrl: "http://127.0.0.1:11434",
			ollamaModel: "qwen2.5",
		});
		expect(
			loadSettings({ shortenLength: "toString", shortenStyle: "table", shortenEngine: "cloud", ollamaUrl: "file:///etc", ollamaModel: "" }),
		).toMatchObject({
			shortenLength: "half",
			shortenStyle: "paragraph",
			shortenEngine: "builtin",
			ollamaUrl: "http://localhost:11434",
			ollamaModel: "llama3.2",
		});
	});
});

describe("color presets", () => {
	it("defaults to the theme accent and keeps a valid saved preset", () => {
		expect(loadSettings(null).colorPreset).toBe("accent");
		expect(loadSettings({ colorPreset: "aurora" }).colorPreset).toBe("aurora");
	});

	it("falls back to the theme accent for unknown presets", () => {
		expect(loadSettings({ colorPreset: "neon" }).colorPreset).toBe("accent");
		expect(loadSettings({ colorPreset: 7 }).colorPreset).toBe("accent");
		expect(loadSettings({ colorPreset: "toString" }).colorPreset).toBe("accent");
	});

	it("maps a preset to its theme classes", () => {
		expect(themeClasses("champagne")).toEqual(["wha-theme", "wha-preset-champagne"]);
	});
});

describe("resolveSlots", () => {
	it("returns exactly one action per segment, padding with empty slots", () => {
		const settings = loadSettings({ slotCount: 6, slots: { 6: ["link", "bold"] } });
		expect(resolveSlots(settings)).toEqual(["link", "bold", "none", "none", "none", "none"]);
	});

	it("empties slots whose custom wrapper was deleted or whose action is unknown", () => {
		const settings = loadSettings({
			slotCount: 4,
			slots: { 4: ["custom:comment", "custom:gone", "constructor", "italic"] },
		});
		expect(resolveSlots(settings)).toEqual(["custom:comment", "none", "none", "italic"]);
	});

	it("defaults to a 6-slot wheel with Extract and Define", () => {
		expect(resolveSlots(loadSettings(null))).toEqual(["link", "bold", "highlight", "extract", "define", "italic"]);
	});
});
