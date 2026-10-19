/** Color presets for the frosted-glass look. Each maps to a `wha-preset-<id>` class in styles.css. */
export type ColorPreset = "accent" | "aurora" | "sunset" | "champagne" | "graphite";

export interface PresetInfo {
	name: string;
}

export const PRESETS: Record<ColorPreset, PresetInfo> = {
	accent: { name: "Theme accent" },
	aurora: { name: "Aurora" },
	sunset: { name: "Sunset" },
	champagne: { name: "Champagne" },
	graphite: { name: "Graphite" },
};

export const PRESET_IDS = Object.keys(PRESETS) as ColorPreset[];

export const isPreset = (value: unknown): value is ColorPreset =>
	typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);

/** Classes that give an element the plugin's glass tokens and the chosen preset's colors. */
export function themeClasses(preset: ColorPreset): string[] {
	return ["wha-theme", `wha-preset-${preset}`];
}
