import { Plugin } from "obsidian";
import { hoverActionsExtension } from "./hover-extension";
import { type LinkRequest, NotePickerModal } from "./note-picker";
import { type WordHoverSettings, loadSettings } from "./settings-model";
import { WordHoverSettingTab } from "./settings-tab";

export default class WordHoverActionsPlugin extends Plugin {
	settings!: WordHoverSettings;

	async onload(): Promise<void> {
		this.settings = loadSettings(await this.loadData());
		this.addSettingTab(new WordHoverSettingTab(this.app, this));
		this.registerEditorExtension(hoverActionsExtension(this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	openLinkPicker(request: LinkRequest): void {
		new NotePickerModal(this.app, request, this.settings.colorPreset).open();
	}
}
