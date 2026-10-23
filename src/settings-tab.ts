import { type App, PluginSettingTab, type Setting, type SettingDefinition, type SettingDefinitionItem, setIcon } from "obsidian";
import { BUILTIN_ACTIONS, type SlotAction, isBuiltin } from "./actions";
import { HoverMenu, type WheelSegment } from "./menu";
import { LENGTH_OPTIONS } from "./modals";
import { PRESETS, PRESET_IDS, themeClasses } from "./theme";
import type WordHoverActionsPlugin from "./main";
import {
	DEFAULT_SETTINGS,
	OPEN_DELAY_RANGE,
	SLOT_COUNTS,
	type SlotCount,
	type WordHoverSettings,
	cleanUrl,
	resolveSlots,
	slotPositionNames,
} from "./settings-model";

type SettingKey = keyof WordHoverSettings;

/** The author's Ko-fi page, also the manifest's fundingUrl. */
const KOFI_URL = "https://ko-fi.com/mdsama";

export class WordHoverSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: WordHoverActionsPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Obsidian renders the tab from these and indexes them for settings search. Rows read the
	 * settings when they render; a change that adds or removes rows, or restyles the preview,
	 * saves and then calls update() to render the tab again.
	 */
	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		const settings = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		const saveAndUpdate = async () => {
			await save();
			this.update();
		};

		const slotRows = slotPositionNames(settings.slotCount).map(
			(position, i): SettingDefinition<SettingKey> => ({
				name: position,
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOptions(this.slotOptions())
							.setValue(resolveSlots(settings)[i])
							.onChange(async (value) => {
								const updated = resolveSlots(settings);
								updated[i] = value as SlotAction;
								settings.slots[settings.slotCount] = updated;
								await saveAndUpdate();
							}),
					);
				},
			}),
		);

		// Unnamed rows (the four text fields of each wrapper) are left out of search.
		const wrapperRows = settings.customWrappers.map(
			(wrapper): SettingDefinition<SettingKey> => ({
				name: "",
				searchable: false,
				render: (setting) => {
					setting
						.setClass("wha-wrapper-setting")
						.addText((text) =>
							text
								.setPlaceholder("Name")
								.setValue(wrapper.name)
								.onChange(async (value) => {
									wrapper.name = value;
									await save();
								}),
						)
						.addText((text) =>
							text
								.setPlaceholder("Icon")
								.setValue(wrapper.icon)
								.onChange(async (value) => {
									wrapper.icon = value.trim();
									await save();
								}),
						)
						.addText((text) =>
							text
								.setPlaceholder("Before")
								.setValue(wrapper.before)
								.onChange(async (value) => {
									wrapper.before = value;
									await save();
								}),
						)
						.addText((text) =>
							text
								.setPlaceholder("After")
								.setValue(wrapper.after)
								.onChange(async (value) => {
									wrapper.after = value;
									await save();
								}),
						)
						.addExtraButton((button) =>
							button
								.setIcon("trash-2")
								.setTooltip("Delete wrapper")
								.onClick(async () => {
									settings.customWrappers = settings.customWrappers.filter((w) => w !== wrapper);
									await saveAndUpdate();
								}),
						);
				},
			}),
		);

		return [
			{
				type: "group",
				heading: "Appearance",
				items: [
					{
						name: "Color preset",
						desc: "Frosted glass in every preset. Light and dark themes are handled automatically. Hover the preview to try it.",
						render: (setting) => {
							const picker = setting.controlEl.createDiv({ cls: "wha-preset-picker" });
							for (const id of PRESET_IDS) {
								const info = PRESETS[id];
								const chip = picker.createDiv({
									cls: `wha-preset-chip${settings.colorPreset === id ? " is-selected" : ""}`,
									attr: { role: "radio", "aria-checked": String(settings.colorPreset === id), "aria-label": info.name, tabindex: "0" },
								});
								chip.createDiv({ cls: ["wha-preset-swatch", ...themeClasses(id)] });
								chip.createDiv({ cls: "wha-preset-name", text: info.name });
								const choose = async () => {
									settings.colorPreset = id;
									await saveAndUpdate();
								};
								chip.addEventListener("click", () => void choose());
								chip.addEventListener("keydown", (event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										void choose();
									}
								});
							}
						},
					},
					{ name: "", searchable: false, render: (setting) => this.renderPreview(setting) },
				],
			},
			{
				type: "group",
				heading: "Wheel",
				items: [
					{
						name: "Open delay",
						desc: "How long to rest on a word, with Shift held, before the wheel opens. Lower is faster; raise it if the wheel opens when you don't want it.",
						control: {
							type: "slider",
							key: "openDelay",
							...OPEN_DELAY_RANGE,
							displayFormat: (value) => `${value} ms`,
						},
					},
					{
						name: "Segments",
						desc: "How many actions the wheel holds. Each size keeps its own layout.",
						render: (setting) => {
							setting.addDropdown((dropdown) => {
								for (const count of SLOT_COUNTS) dropdown.addOption(String(count), String(count));
								dropdown.setValue(String(settings.slotCount)).onChange(async (value) => {
									settings.slotCount = Number(value) as SlotCount;
									await saveAndUpdate();
								});
							});
						},
					},
					...slotRows,
				],
			},
			{
				type: "group",
				heading: "Custom wrappers",
				items: [
					...wrapperRows,
					{
						name: "Add a custom wrapper",
						desc: "Toggles of your own, such as %%comment%% or <u>underline</u>. Icons are Lucide names, e.g. sigma or underline.",
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText("Add wrapper").onClick(async () => {
									settings.customWrappers.push({ id: Date.now().toString(36), name: "New wrapper", icon: "brackets", before: "", after: "" });
									await saveAndUpdate();
								}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: "After linking",
				items: [
					{
						name: "Offer to link other mentions",
						desc: "After you link a word, offer to link the other plain mentions of it in the same note.",
						control: { type: "toggle", key: "offerLinkAll" },
					},
					{
						name: "Learn aliases",
						desc: "When the linked wording differs from the note's name (TB → Tuberculosis), save it as an alias of that note.",
						control: { type: "dropdown", key: "learnAliases", options: { ask: "Ask each time", always: "Always", never: "Never" } },
					},
				],
			},
			{
				type: "group",
				heading: "Extract to note",
				items: [
					{
						name: "Replace the passage with",
						control: {
							type: "dropdown",
							key: "extractReplace",
							options: { link: "A link to the new note", embed: "An embed of the new note" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Shorten",
				items: [
					{
						name: "Length",
						desc: "How much of the paragraph or selection to keep. You can change it in the dialog each time.",
						control: { type: "dropdown", key: "shortenLength", options: LENGTH_OPTIONS },
					},
					{
						name: "Method",
						desc: "Built-in works offline: it keeps the key sentences in their own wording and trims filler. A local AI rewrites the text; it needs Ollama running on your computer.",
						render: (setting) => {
							setting.addDropdown((dropdown) =>
								dropdown
									.addOptions({ builtin: "Built-in (offline)", ollama: "Local AI (Ollama)" })
									.setValue(settings.shortenEngine)
									.onChange(async (value) => {
										settings.shortenEngine = value === "ollama" ? "ollama" : "builtin";
										await saveAndUpdate();
									}),
							);
						},
					},
					{
						name: "Ollama address",
						desc: "Shorten sends the passage here, and only here, when you use it.",
						visible: () => settings.shortenEngine === "ollama",
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl)
									.setValue(settings.ollamaUrl)
									.onChange(async (value) => {
										const url = cleanUrl(value);
										if (!url) return;
										settings.ollamaUrl = url;
										await save();
									}),
							);
						},
					},
					{
						name: "Ollama model",
						desc: "A model you have downloaded with Ollama, such as llama3.2 or qwen2.5.",
						visible: () => settings.shortenEngine === "ollama",
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(DEFAULT_SETTINGS.ollamaModel)
									.setValue(settings.ollamaModel)
									.onChange(async (value) => {
										if (!value.trim()) return;
										settings.ollamaModel = value.trim();
										await save();
									}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Look up",
				items: [
					{
						name: "Language",
						desc: "Wikipedia and Wiktionary language code, e.g. en, de, hi. Look-ups only run when you click Define.",
						render: (setting) => {
							setting.addText((text) =>
								text.setValue(settings.lookupLanguage).onChange(async (value) => {
									const code = value.trim().toLowerCase();
									if (!/^[a-z]{2,3}(-[a-z]+)?$/.test(code)) return;
									settings.lookupLanguage = code;
									await save();
								}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Support",
				items: [
					{
						name: "Support Word Hover Actions",
						desc: "If the plugin helps you, you can support its development on Ko-fi.",
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText("Support me on Ko-fi").onClick(() => window.open(KOFI_URL));
								// A button holds an icon or text, not both, so the icon goes in beside the text.
								button.buttonEl.addClass("wha-kofi-button");
								setIcon(button.buttonEl.createSpan({ cls: "wha-kofi-icon", prepend: true }), "coffee");
							});
						},
					},
				],
			},
		];
	}

	/** Slot choices: the built-in actions and the custom wrappers by their current names. */
	private slotOptions(): Record<string, string> {
		const options: Record<string, string> = { none: "(empty)" };
		for (const [id, info] of Object.entries(BUILTIN_ACTIONS)) options[id] = info.title;
		for (const wrapper of this.plugin.settings.customWrappers) options[`custom:${wrapper.id}`] = `Custom: ${wrapper.name || "untitled"}`;
		return options;
	}

	/** A live wheel with the current slots and preset; hovering it shows the real effects. */
	private renderPreview(setting: Setting): void {
		const { settings } = this.plugin;
		const segments: WheelSegment[] = resolveSlots(settings).map((id, i) => {
			if (id === "none") return { id, icon: "", label: "", description: "", enabled: false, active: false, empty: true };
			const wrapper = isBuiltin(id) ? null : settings.customWrappers.find((w) => `custom:${w.id}` === id);
			const info = isBuiltin(id)
				? BUILTIN_ACTIONS[id]
				: { label: wrapper?.name ?? "Wrapper", title: wrapper?.name ?? "Wrapper", icon: wrapper?.icon || "brackets" };
			// Show one segment as already applied so the preview covers that state too.
			return { id, icon: info.icon, label: info.label, description: info.title, enabled: true, active: i === 1 };
		});
		// The stage fills the row's control area, which Obsidian empties before each render.
		setting.setClass("wha-preview-setting");
		const stage = setting.controlEl.createDiv({ cls: "wha-preview-stage" });
		const menu = new HoverMenu(
			stage.ownerDocument,
			{ segments, hub: "Preview", hubMuted: false, themeClasses: themeClasses(settings.colorPreset) },
			() => undefined,
			() => undefined,
		);
		menu.el.classList.add("is-preview");
		stage.appendChild(menu.el);
	}
}
