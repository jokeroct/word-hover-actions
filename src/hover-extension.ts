import { type EditorState, type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Notice, editorInfoField } from "obsidian";
import type WordHoverActionsPlugin from "./main";
import { type Box, HoverMenu, type Point, type WheelSpec, inBox } from "./menu";
import { reasonForNodeName } from "./text/context";
import { type HoverTarget, resolveTarget } from "./text/target";
import { type WheelContext, buildWheel, runWheelAction } from "./wheel-actions";

/** Pause before the menu opens once the pointer settles on a word with Shift held. */
const HOVER_DELAY_MS = 120;
/** Delay after pressing Shift over a word; a little longer so a capital letter typed next cancels it first. */
const KEY_HOVER_DELAY_MS = 150;
/** How long the pointer may be outside the word and menu (e.g. crossing the gap) before the menu closes. */
const LEAVE_GRACE_MS = 300;
/** Pointer jitter that doesn't restart the pause. */
const MOVE_TOLERANCE_PX = 4;
/** Padding around the word and the menu that still counts as "inside". */
const REGION_SLACK_PX = 6;
/** A Shift press this soon after typing is treated as typing a capital, not as a hover. */
const TYPING_GRACE_MS = 1000;
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn", "OS"]);

interface TargetMark {
	from: number;
	to: number;
	fromSelection: boolean;
	/** Theme classes, so the mark uses the chosen preset's colors. */
	classes: string;
}

const setTargetMark = StateEffect.define<TargetMark | null>();

/** Tints the target while the menu is open. Clears itself on edits, and on selection changes for selection targets. */
const targetMarkField = StateField.define<{ mark: TargetMark | null; deco: DecorationSet }>({
	create: () => ({ mark: null, deco: Decoration.none }),
	update(value, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(setTargetMark)) continue;
			const mark = effect.value;
			const deco = mark
				? Decoration.set([Decoration.mark({ class: `wha-hover-target ${mark.classes}` }).range(mark.from, mark.to)])
				: Decoration.none;
			return { mark, deco };
		}
		if (value.mark && (tr.docChanged || (tr.selection && value.mark.fromSelection))) {
			return { mark: null, deco: Decoration.none };
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
});

function syntaxReason(state: EditorState, from: number, to: number): string | null {
	let reason: string | null = null;
	syntaxTree(state).iterate({
		from,
		to,
		enter(node) {
			if (reason !== null) return false;
			if (node.from < to && node.to > from) reason = reasonForNodeName(node.name);
			return undefined;
		},
	});
	return reason;
}

interface OpenMenu {
	target: HoverTarget;
	/** The document the target was computed against; any edit makes the target stale. */
	doc: Text;
	menu: HoverMenu;
	box: Box | null;
	context: WheelContext;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The range the wheel's actions apply to: the whole link for link tools, otherwise the target itself. */
function actedOn(target: HoverTarget): { from: number; to: number } {
	return target.existingLink ? { from: target.existingLink.docFrom, to: target.existingLink.docTo } : target;
}

/** Keys that type or delete text, as opposed to shortcuts such as Ctrl+Z or navigation keys. */
function isTypingKey(event: KeyboardEvent): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) return false;
	return event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
}

/**
 * One per editor. Tracks Shift and the pointer, opens the menu after a pause over a word or
 * inside a selection, and closes it on Escape, typing, edits, scrolling, clicks elsewhere, or
 * when the pointer leaves both the target and the menu.
 */
class HoverController implements PluginValue {
	private readonly doc: Document;
	private readonly win: Window;
	private readonly disposers: Array<() => void> = [];
	private shiftDown = false;
	private pointer: Point | null = null;
	private hoverTimer: number | null = null;
	private hoverOrigin: Point | null = null;
	private leaveTimer: number | null = null;
	private lastTypingAt = -Infinity;
	private current: OpenMenu | null = null;
	private destroyed = false;

	constructor(
		private readonly view: EditorView,
		private readonly plugin: WordHoverActionsPlugin,
	) {
		this.doc = view.dom.ownerDocument;
		this.win = this.doc.defaultView ?? window;
		this.listen(view.dom, "mousemove", this.onEditorMouseMove, { passive: true });
		this.listen(view.dom, "mouseleave", this.onEditorMouseLeave);
		this.listen(this.win, "keydown", this.onKeyDown, true);
		this.listen(this.win, "keyup", this.onKeyUp, true);
		this.listen(this.win, "blur", this.onInterrupt);
		this.listen(this.win, "resize", this.onInterrupt);
		this.listen(this.doc, "scroll", this.onInterrupt, { capture: true, passive: true });
		this.listen(this.doc, "mousedown", this.onDocumentMouseDown, true);
		this.listen(this.doc, "mousemove", this.onDocumentMouseMove, { capture: true, passive: true });
		this.listen(this.doc.documentElement, "mouseleave", this.onDocumentMouseLeave);
	}

	update(update: ViewUpdate): void {
		// The mark field clears itself in these cases, so only the menu needs removing (no dispatch mid-update).
		if (update.docChanged) {
			this.cancelHover();
			this.dismiss(false);
		} else if (update.selectionSet && this.current?.target.source === "selection") {
			this.dismiss(false);
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.cancelHover();
		this.dismiss(false);
		for (const dispose of this.disposers) dispose();
	}

	private listen<E extends Event>(
		target: EventTarget,
		type: string,
		handler: (event: E) => void,
		options?: boolean | AddEventListenerOptions,
	): void {
		const listener = handler as EventListener;
		target.addEventListener(type, listener, options);
		this.disposers.push(() => target.removeEventListener(type, listener, options));
	}

	// ---- input tracking -------------------------------------------------------------------

	private readonly onEditorMouseMove = (event: MouseEvent): void => {
		this.shiftDown = event.shiftKey;
		if (event.buttons !== 0) {
			// Dragging (e.g. Shift+drag to extend a selection) is not hovering.
			this.pointer = null;
			this.cancelHover();
			return;
		}
		this.pointer = { x: event.clientX, y: event.clientY };
		if (event.shiftKey) this.scheduleHover(false);
		else this.cancelHover();
	};

	private readonly onEditorMouseLeave = (): void => {
		this.pointer = null;
		this.cancelHover();
	};

	private readonly onDocumentMouseMove = (event: MouseEvent): void => {
		if (!this.current) return;
		if (this.inRegion({ x: event.clientX, y: event.clientY })) this.clearLeaveTimer();
		else this.startLeaveTimer();
	};

	private readonly onDocumentMouseLeave = (): void => {
		if (this.current) this.startLeaveTimer();
	};

	private readonly onDocumentMouseDown = (event: MouseEvent): void => {
		this.cancelHover();
		if (this.current && !this.current.menu.el.contains(event.target as Node)) this.dismiss();
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Shift") {
			this.shiftDown = true;
			if (!event.repeat) this.scheduleHover(true);
			return;
		}
		if (event.key === "Escape" && this.current) {
			event.preventDefault();
			event.stopPropagation();
			this.cancelHover();
			this.dismiss();
			return;
		}
		if (MODIFIER_KEYS.has(event.key)) return;
		if (isTypingKey(event)) this.lastTypingAt = performance.now();
		this.cancelHover();
		this.dismiss();
	};

	private readonly onKeyUp = (event: KeyboardEvent): void => {
		if (event.key !== "Shift") return;
		// Releasing Shift cancels a pending hover but leaves an open menu usable.
		this.shiftDown = false;
		this.cancelHover();
	};

	private readonly onInterrupt = (): void => {
		this.cancelHover();
		this.dismiss();
	};

	// ---- hover timing ---------------------------------------------------------------------

	private scheduleHover(fromKey: boolean): void {
		if (!this.shiftDown || !this.pointer) return;
		if (fromKey && performance.now() - this.lastTypingAt < TYPING_GRACE_MS) return;
		const settling = this.hoverTimer !== null && this.hoverOrigin !== null;
		if (!fromKey && settling && distance(this.pointer, this.hoverOrigin!) < MOVE_TOLERANCE_PX) return;
		this.cancelHover();
		this.hoverOrigin = { ...this.pointer };
		this.hoverTimer = this.win.setTimeout(this.onHoverTimer, fromKey ? KEY_HOVER_DELAY_MS : HOVER_DELAY_MS);
	}

	private cancelHover(): void {
		if (this.hoverTimer !== null) this.win.clearTimeout(this.hoverTimer);
		this.hoverTimer = null;
		this.hoverOrigin = null;
	}

	private startLeaveTimer(): void {
		if (this.leaveTimer !== null) return;
		this.leaveTimer = this.win.setTimeout(() => {
			this.leaveTimer = null;
			this.dismiss();
		}, LEAVE_GRACE_MS);
	}

	private clearLeaveTimer(): void {
		if (this.leaveTimer !== null) this.win.clearTimeout(this.leaveTimer);
		this.leaveTimer = null;
	}

	private readonly onHoverTimer = (): void => {
		this.hoverTimer = null;
		this.hoverOrigin = null;
		const pointer = this.pointer;
		if (this.destroyed || !this.shiftDown || !pointer || this.view.composing || !this.view.dom.isConnected) return;
		const info = this.view.state.field(editorInfoField, false);
		if (!info?.editor) return;
		const hit = this.hitTest(pointer);
		if (!hit) return;
		const state = this.view.state;
		const target = resolveTarget(state.doc, hit.index, state.selection.ranges, (from, to) =>
			syntaxReason(state, from, to),
		);
		if (!target) return;
		const open = this.current;
		if (open && open.doc === state.doc) {
			const a = actedOn(open.target);
			const b = actedOn(target);
			if (a.from === b.from && a.to === b.to) return;
		}
		const context: WheelContext = {
			plugin: this.plugin,
			view: this.view,
			editor: info.editor,
			sourcePath: info.file?.path ?? "",
			sourceFile: info.file ?? null,
			target,
			doc: state.doc,
		};
		this.show(context, buildWheel(context), hit.rect);
	};

	// ---- geometry -------------------------------------------------------------------------

	/**
	 * The document index of the character actually under the pointer, or null over whitespace past
	 * the end of a line, padding, widgets (embeds, rendered tables, math), or nested editors.
	 */
	private hitTest(p: Point): { index: number; rect: Box } | null {
		const el = this.doc.elementFromPoint(p.x, p.y);
		if (!el || !this.view.contentDOM.contains(el)) return null;
		if (el.closest("[contenteditable]") !== this.view.contentDOM) return null;
		const pos = this.view.posAtCoords(p);
		if (pos === null) return null;
		const line = this.view.state.doc.lineAt(pos);
		for (const index of [pos, pos - 1]) {
			if (index < line.from || index >= line.to) continue;
			const start = this.view.coordsAtPos(index, 1);
			const end = this.view.coordsAtPos(index + 1, -1);
			if (!start || !end) continue;
			const rect = {
				left: Math.min(start.left, end.left),
				right: Math.max(start.left, end.left),
				top: Math.min(start.top, end.top),
				bottom: Math.max(start.bottom, end.bottom),
			};
			if (rect.right - rect.left >= 0.5 && inBox(rect, p)) return { index, rect };
		}
		return null;
	}

	/** The target's on-screen box, and whether it sits on a single visual line. */
	private targetBox(target: { from: number; to: number }): { box: Box; singleLine: boolean } | null {
		const start = this.view.coordsAtPos(target.from, 1);
		const end = this.view.coordsAtPos(target.to, -1);
		if (!start || !end) return null;
		if (Math.abs(start.top - end.top) < 1) {
			const box = {
				left: Math.min(start.left, end.left),
				right: Math.max(start.left, end.left),
				top: Math.min(start.top, end.top),
				bottom: Math.max(start.bottom, end.bottom),
			};
			return { box, singleLine: true };
		}
		// Wrapped across visual lines: use the full width of the lines it covers.
		const content = this.view.contentDOM.getBoundingClientRect();
		return { box: { left: content.left, right: content.right, top: start.top, bottom: end.bottom }, singleLine: false };
	}

	private inRegion(p: Point): boolean {
		const open = this.current;
		if (!open) return false;
		return (open.box !== null && inBox(open.box, p, REGION_SLACK_PX)) || open.menu.contains(p, REGION_SLACK_PX);
	}

	// ---- menu lifecycle -------------------------------------------------------------------

	/** Opens the wheel beside the target, or beside the hovered character when the target wraps. */
	private show(context: WheelContext, spec: WheelSpec, hovered: Box): void {
		const { target } = context;
		this.current?.menu.destroy();
		this.clearLeaveTimer();
		const menu = new HoverMenu(
			this.doc,
			spec,
			(id) => this.run(id),
			() => this.dismiss(),
		);
		// Link tools act on the whole link, so anchor to (and mark) all of it, not just the hovered word.
		const span = actedOn(target);
		const geometry = this.targetBox(span);
		menu.place(geometry?.singleLine ? geometry.box : hovered);
		this.current = { target, doc: context.doc, menu, box: geometry?.box ?? null, context };
		this.view.dispatch({
			effects: setTargetMark.of({
				from: span.from,
				to: span.to,
				fromSelection: target.source === "selection",
				classes: spec.themeClasses.join(" "),
			}),
		});
	}

	private dismiss(clearMark = true): void {
		this.clearLeaveTimer();
		if (!this.current) return;
		this.current.menu.destroy();
		this.current = null;
		if (clearMark && !this.destroyed && this.view.state.field(targetMarkField, false)?.mark) {
			this.view.dispatch({ effects: setTargetMark.of(null) });
		}
	}

	private run(id: string): void {
		const open = this.current;
		if (!open) return;
		this.dismiss();
		if (this.view.state.doc !== open.doc) {
			new Notice("The note changed, so nothing was applied.");
			return;
		}
		runWheelAction(open.context, id);
	}
}

export function hoverActionsExtension(plugin: WordHoverActionsPlugin): Extension {
	return [targetMarkField, ViewPlugin.define((view) => new HoverController(view, plugin))];
}
