import { type App, PluginSettingTab, Setting } from "obsidian";
import { BUILTIN_ACTIONS, type SlotAction, isBuiltin } from "./actions";
import { HoverMenu, type WheelSegment } from "./menu";
import { PRESETS, PRESET_IDS, themeClasses } from "./theme";
import type WordHoverActionsPlugin from "./main";
import { SLOT_COUNTS, type SlotCount, resolveSlots, slotPositionNames } from "./settings-model";

export class WordHoverSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: WordHoverActionsPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl, plugin } = this;
		const settings = plugin.settings;
		const save = () => plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl).setName("Appearance").setHeading();
		const presetSetting = new Setting(containerEl)
			.setName("Color preset")
			.setDesc("Frosted glass in every preset. Light and dark themes are handled automatically. Hover the preview to try it.");
		const picker = presetSetting.controlEl.createDiv({ cls: "wha-preset-picker" });
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
				await save();
				this.display();
			};
			chip.addEventListener("click", () => void choose());
			chip.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					void choose();
				}
			});
		}
		this.renderPreview(containerEl.createDiv({ cls: "wha-preview-stage" }));

		new Setting(containerEl).setName("Wheel").setHeading();
		new Setting(containerEl)
			.setName("Segments")
			.setDesc("How many actions the wheel holds. Each size keeps its own layout.")
			.addDropdown((dropdown) => {
				for (const count of SLOT_COUNTS) dropdown.addOption(String(count), String(count));
				dropdown.setValue(String(settings.slotCount)).onChange(async (value) => {
					settings.slotCount = Number(value) as SlotCount;
					await save();
					this.display();
				});
			});

		const options: Record<string, string> = { none: "(empty)" };
		for (const [id, info] of Object.entries(BUILTIN_ACTIONS)) options[id] = info.title;
		for (const wrapper of settings.customWrappers) options[`custom:${wrapper.id}`] = `Custom: ${wrapper.name || "untitled"}`;
		const slots = resolveSlots(settings);
		slotPositionNames(settings.slotCount).forEach((position, i) => {
			new Setting(containerEl).setName(position).addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(slots[i])
					.onChange(async (value) => {
						const updated = resolveSlots(settings);
						updated[i] = value as SlotAction;
						settings.slots[settings.slotCount] = updated;
						await save();
						this.display();
					}),
			);
		});

		new Setting(containerEl)
			.setName("Custom wrappers")
			.setDesc("Toggles of your own, such as %%comment%% or <u>underline</u>. Icons are Lucide names, e.g. sigma or underline.")
			.setHeading();
		for (const wrapper of settings.customWrappers) {
			new Setting(containerEl)
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
							await save();
							this.display();
						}),
				);
		}
		new Setting(containerEl).addButton((button) =>
			button.setButtonText("Add wrapper").onClick(async () => {
				settings.customWrappers.push({ id: Date.now().toString(36), name: "New wrapper", icon: "brackets", before: "", after: "" });
				await save();
				this.display();
			}),
		);

		new Setting(containerEl).setName("After linking").setHeading();
		new Setting(containerEl)
			.setName("Offer to link other mentions")
			.setDesc("After you link a word, offer to link the other plain mentions of it in the same note.")
			.addToggle((toggle) =>
				toggle.setValue(settings.offerLinkAll).onChange(async (value) => {
					settings.offerLinkAll = value;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Learn aliases")
			.setDesc("When the linked wording differs from the note's name (TB → Tuberculosis), save it as an alias of that note.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ ask: "Ask each time", always: "Always", never: "Never" })
					.setValue(settings.learnAliases)
					.onChange(async (value) => {
						settings.learnAliases = value as typeof settings.learnAliases;
						await save();
					}),
			);

		new Setting(containerEl).setName("Extract to note").setHeading();
		new Setting(containerEl)
			.setName("Replace the passage with")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ link: "A link to the new note", embed: "An embed of the new note" })
					.setValue(settings.extractReplace)
					.onChange(async (value) => {
						settings.extractReplace = value === "embed" ? "embed" : "link";
						await save();
					}),
			);

		new Setting(containerEl).setName("Look up").setHeading();
		new Setting(containerEl)
			.setName("Language")
			.setDesc("Wikipedia and Wiktionary language code, e.g. en, de, hi. Look-ups only run when you click Define.")
			.addText((text) =>
				text.setValue(settings.lookupLanguage).onChange(async (value) => {
					const code = value.trim().toLowerCase();
					if (!/^[a-z]{2,3}(-[a-z]+)?$/.test(code)) return;
					settings.lookupLanguage = code;
					await save();
				}),
			);
	}

	/** A live wheel with the current slots and preset; hovering it shows the real effects. */
	private renderPreview(stage: HTMLElement): void {
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
