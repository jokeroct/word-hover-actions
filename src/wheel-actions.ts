import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type Editor, Notice, type TFile } from "obsidian";
import { type ActionInfo, BUILTIN_ACTIONS, LINK_TOOLS, LINK_TOOL_ORDER, type SlotAction, isBuiltin } from "./actions";
import { offerFollowUps } from "./follow-ups";
import type WordHoverActionsPlugin from "./main";
import type { WheelSegment, WheelSpec } from "./menu";
import { countBacklinks, DefineModal, ExtractModal, PeekModal, ShortenModal } from "./modals";
import type { LinkRequest } from "./note-picker";
import { type CustomWrapper, resolveSlots } from "./settings-model";
import { type FormatPlan, planWrap } from "./text/format";
import { isTableRow } from "./text/links";
import type { ExistingLink, HoverTarget } from "./text/target";
import { themeClasses } from "./theme";

/** Everything an action needs, captured when the wheel opens. */
export interface WheelContext {
	plugin: WordHoverActionsPlugin;
	view: EditorView;
	editor: Editor;
	sourcePath: string;
	sourceFile: TFile | null;
	target: HoverTarget;
	/** The document the target was computed against. */
	doc: Text;
}

type Plan = { ok: true; active?: boolean } | { ok: false; reason: string };

const EMPTY_SEGMENT = (id: string): WheelSegment => ({
	id,
	icon: "",
	label: "",
	description: "",
	enabled: false,
	active: false,
	empty: true,
});

function segment(id: string, info: ActionInfo, plan: Plan): WheelSegment {
	const active = plan.ok && plan.active === true;
	const description = plan.ok ? (active && info.activeTitle ? info.activeTitle : info.title) : plan.reason;
	return { id, icon: info.icon, label: info.label, description, enabled: plan.ok, active };
}

function wrapperFor(ctx: WheelContext, id: string): CustomWrapper | undefined {
	return ctx.plugin.settings.customWrappers.find((w) => `custom:${w.id}` === id);
}

function wrapperInfo(wrapper: CustomWrapper): ActionInfo {
	const name = wrapper.name || "Wrapper";
	return {
		label: name,
		title: `${name}: ${wrapper.before}…${wrapper.after}`,
		activeTitle: `Remove ${name.toLowerCase()}`,
		icon: wrapper.icon || "brackets",
	};
}

function wrapperPlan(ctx: WheelContext, wrapper: CustomWrapper): FormatPlan {
	const { target, doc } = ctx;
	if (target.blocked) return { ok: false, reason: target.blocked };
	return planWrap(doc, target, wrapper.before, wrapper.after);
}

function slotSegment(ctx: WheelContext, id: SlotAction): WheelSegment {
	const { target } = ctx;
	if (id === "none") return EMPTY_SEGMENT(id);
	if (!isBuiltin(id)) {
		const wrapper = wrapperFor(ctx, id);
		return wrapper ? segment(id, wrapperInfo(wrapper), wrapperPlan(ctx, wrapper)) : EMPTY_SEGMENT(id);
	}
	const info = BUILTIN_ACTIONS[id];
	switch (id) {
		case "extract":
			return segment(id, info, target.extract);
		case "define":
			return segment(id, info, target.lookup);
		default:
			return segment(id, info, target[id]);
	}
}

function linkSegments(ctx: WheelContext, link: ExistingLink): WheelSpec {
	const { app } = ctx.plugin;
	const file = link.external ? null : app.metadataCache.getFirstLinkpathDest(link.target, ctx.sourcePath);
	const editable = link.kind !== "embed";
	const plans: Record<(typeof LINK_TOOL_ORDER)[number], Plan> = {
		peek: file ? { ok: true } : { ok: false, reason: link.external ? "External link" : "That note doesn't exist yet" },
		unlink: editable ? { ok: true } : { ok: false, reason: "Embeds can't be unlinked" },
		retarget: editable && !/[[\]|]/.test(link.display) ? { ok: true } : { ok: false, reason: "Can't change this link" },
		"open-split": { ok: true },
	};
	const segments = LINK_TOOL_ORDER.map((id) => {
		const info = { ...LINK_TOOLS[id] };
		if (id === "peek" && file) {
			const count = countBacklinks(app, file);
			info.title = `Preview · linked from ${count} note${count === 1 ? "" : "s"}`;
		}
		if (id === "unlink") info.title = `Unlink, keep “${link.display}”`;
		if (id === "open-split") info.title = link.external ? "Open in browser" : file ? "Open in a split pane" : "Create and open in a split";
		return segment(id, info, plans[id]);
	});
	const name = link.external ? link.target.replace(/^[a-z]+:\/\//i, "").split("/")[0] : (file?.basename ?? link.target);
	return {
		segments,
		hub: `→ ${name}`,
		hubMuted: false,
		variant: "wha-wheel-links",
		themeClasses: themeClasses(ctx.plugin.settings.colorPreset),
	};
}

/** The wheel for a target: link tools when it is already a link, otherwise the configured slots. */
export function buildWheel(ctx: WheelContext): WheelSpec {
	const { target } = ctx;
	if (target.existingLink) return linkSegments(ctx, target.existingLink);
	return {
		segments: resolveSlots(ctx.plugin.settings).map((id) => slotSegment(ctx, id)),
		hub: target.blocked ?? target.text,
		hubMuted: target.blocked !== null,
		themeClasses: themeClasses(ctx.plugin.settings.colorPreset),
	};
}

function applyPlan(ctx: WheelContext, plan: FormatPlan): void {
	if (!plan.ok) return;
	const { editor, target } = ctx;
	editor.transaction({
		changes: plan.changes.map((change) => ({
			from: editor.offsetToPos(change.from),
			to: editor.offsetToPos(change.to),
			text: change.insert,
		})),
	});
	if (target.source === "selection") {
		editor.setSelection(editor.offsetToPos(plan.selection.from), editor.offsetToPos(plan.selection.to));
	}
}

function linkRequest(ctx: WheelContext, followUps: boolean): LinkRequest | null {
	const { target, plugin } = ctx;
	if (!target.link.ok) return null;
	return {
		view: ctx.view,
		editor: ctx.editor,
		sourcePath: ctx.sourcePath,
		from: target.link.from,
		to: target.link.to,
		text: target.link.text,
		doc: ctx.doc,
		inTable: isTableRow(ctx.doc.lineAt(target.from).text),
		onLinked: followUps
			? (file, created) =>
					offerFollowUps({
						app: plugin.app,
						settings: plugin.settings,
						view: ctx.view,
						editor: ctx.editor,
						sourcePath: ctx.sourcePath,
						file,
						text: target.link.ok ? target.link.text : "",
						created,
					})
			: undefined,
	};
}

function runLinkTool(ctx: WheelContext, id: string, link: ExistingLink): void {
	const { plugin, editor, sourcePath } = ctx;
	const { app } = plugin;
	const file = link.external ? null : app.metadataCache.getFirstLinkpathDest(link.target, sourcePath);
	switch (id) {
		case "peek":
			if (file) new PeekModal(app, file, plugin.settings).open();
			return;
		case "unlink":
			editor.transaction({
				changes: [{ from: editor.offsetToPos(link.docFrom), to: editor.offsetToPos(link.docTo), text: link.display }],
			});
			return;
		case "retarget":
			plugin.openLinkPicker({
				view: ctx.view,
				editor,
				sourcePath,
				from: link.docFrom,
				to: link.docTo,
				text: link.display,
				doc: ctx.doc,
				inTable: isTableRow(ctx.doc.lineAt(link.docFrom).text),
			});
			return;
		case "open-split":
			if (link.external) window.open(link.target);
			else void app.workspace.openLinkText(link.target + link.subpath, sourcePath, "split");
			return;
	}
}

/** Runs the chosen segment. The caller has already checked that the document is unchanged. */
export function runWheelAction(ctx: WheelContext, id: string): void {
	const { target, plugin } = ctx;
	if (target.existingLink) {
		runLinkTool(ctx, id, target.existingLink);
		return;
	}
	switch (id) {
		case "link": {
			const request = linkRequest(ctx, true);
			if (request) plugin.openLinkPicker(request);
			return;
		}
		case "bold":
		case "italic":
		case "highlight":
		case "strikethrough":
			applyPlan(ctx, target[id]);
			return;
		case "extract":
			if (!target.extract.ok) return;
			new ExtractModal(plugin.app, plugin.settings, {
				view: ctx.view,
				editor: ctx.editor,
				sourcePath: ctx.sourcePath,
				sourceFile: ctx.sourceFile,
				from: target.extract.from,
				to: target.extract.to,
				text: target.extract.text,
				doc: ctx.doc,
			}).open();
			return;
		case "define":
			if (!target.lookup.ok) return;
			new DefineModal(plugin.app, plugin.settings, target.lookup.term, linkRequest(ctx, true), ctx.sourcePath).open();
			return;
		case "shorten":
			if (!target.shorten.ok) return;
			new ShortenModal(plugin.app, plugin.settings, {
				view: ctx.view,
				editor: ctx.editor,
				sourcePath: ctx.sourcePath,
				doc: ctx.doc,
				passage: target.shorten,
			}).open();
			return;
		default: {
			const wrapper = wrapperFor(ctx, id);
			if (wrapper) applyPlan(ctx, wrapperPlan(ctx, wrapper));
			else new Notice("That wheel action no longer exists. Check the plugin settings.");
		}
	}
}
