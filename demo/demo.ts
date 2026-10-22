// Interactive demo of the Word Hover Actions wheel for the project's GitHub Pages site.
// The wheel itself is the plugin's real code (src/menu.ts) and real stylesheet; only the note
// and the effects of actions are simulated, since there is no Obsidian vault in a web page.
import { BUILTIN_ACTIONS, LINK_TOOLS, LINK_TOOL_ORDER, type ActionInfo, type SlotAction } from "../src/actions";
import { type Box, HoverMenu, type Point, type WheelSegment, type WheelSpec, inBox } from "../src/menu";
import { DEFAULT_SETTINGS, type SlotCount } from "../src/settings-model";
import { type ColorPreset, PRESETS, PRESET_IDS, isPreset, themeClasses } from "../src/theme";

const HOVER_DELAY_MS = 40;
const KEY_HOVER_DELAY_MS = 120;
const LEAVE_GRACE_MS = 300;
const REGION_SLACK_PX = 6;

const params = new URLSearchParams(location.search);
const state = {
	preset: (isPreset(params.get("preset")) ? params.get("preset") : "aurora") as ColorPreset,
	theme: params.get("theme") ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"),
	slots: ([4, 6, 8].includes(Number(params.get("slots"))) ? Number(params.get("slots")) : 6) as SlotCount,
};

/** Formatting toggles shown as classes on the word spans. */
const FORMAT_CLASS: Record<string, string> = {
	bold: "is-bold",
	italic: "is-italic",
	highlight: "is-highlight",
	strikethrough: "is-strike",
	"custom:comment": "is-comment",
	"custom:math": "is-math",
};

/** Note names the demo links some words to, so alias offers make sense. */
const LINK_TITLES: Record<string, string> = { tb: "Tuberculosis", infectious: "Infection", graph: "Graph view" };

const DEFINITIONS: Record<string, { title: string; summary: string; senses: string[] }> = {
	tb: {
		title: "Tuberculosis",
		summary: "Tuberculosis (TB) is an infectious disease usually caused by Mycobacterium tuberculosis bacteria.",
		senses: ["(medicine) Abbreviation of tuberculosis."],
	},
	infectious: {
		title: "Infection",
		summary: "An infection is the invasion of tissues by pathogens, their multiplication, and the reaction of host tissues to them.",
		senses: ["Caused by an agent that enters the host's body.", "Able to infect others; capable of transmitting pathogens."],
	},
	isoniazid: {
		title: "Isoniazid",
		summary: "Isoniazid is an antibiotic used for the treatment of tuberculosis.",
		senses: ["(pharmacology) An antibacterial drug used to treat tuberculosis."],
	},
};

const note = document.querySelector<HTMLElement>(".demo-note")!;

interface Target {
	spans: HTMLElement[];
	text: string;
	isLink: boolean;
	selection: boolean;
}

// ---- Words --------------------------------------------------------------------------------

/** Wraps every word of the note in a span so it can be hovered and formatted. */
function tokenize(root: HTMLElement): void {
	for (const p of root.querySelectorAll<HTMLElement>("[data-words]")) {
		for (const node of [...p.childNodes]) {
			if (node.nodeType === Node.TEXT_NODE) {
				const fragment = createFragment();
				for (const part of (node.textContent ?? "").split(/([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u)) {
					if (!part) continue;
					if (/^[\p{L}\p{N}]/u.test(part)) fragment.createSpan({ cls: "w", text: part });
					else fragment.appendChild(document.createTextNode(part));
				}
				node.replaceWith(fragment);
			} else if (node.instanceOf(HTMLElement) && node.matches("a.internal-link")) {
				node.classList.add("w", "is-link");
			}
		}
	}
}

const words = () => [...note.querySelectorAll<HTMLElement>(".w")];
const wordAt = (el: EventTarget | Element | null) => (el instanceof Element ? el.closest<HTMLElement>(".demo-note .w") : null);
const key = (text: string) => text.toLowerCase();

function targetFor(span: HTMLElement): Target {
	if (span.classList.contains("is-link")) return { spans: [span], text: span.textContent ?? "", isLink: true, selection: false };
	const selection = getSelection();
	if (selection && !selection.isCollapsed && selection.containsNode(span, true)) {
		const spans = words().filter((w) => selection.containsNode(w, true) && !w.classList.contains("is-link"));
		if (spans.length > 1) return { spans, text: spans.map((s) => s.textContent).join(" "), isLink: false, selection: true };
	}
	return { spans: [span], text: span.textContent ?? "", isLink: false, selection: false };
}

// ---- Wheel contents (mirrors src/wheel-actions.ts) -------------------------------------------

type Plan = { ok: true; active?: boolean } | { ok: false; reason: string };

function segment(id: string, info: ActionInfo, plan: Plan): WheelSegment {
	const active = plan.ok && plan.active === true;
	const description = plan.ok ? (active && info.activeTitle ? info.activeTitle : info.title) : plan.reason;
	return { id, icon: info.icon, label: info.label, description, enabled: plan.ok, active };
}

function slotsFor(count: SlotCount): SlotAction[] {
	return DEFAULT_SETTINGS.slots[count];
}

function wheelFor(target: Target): WheelSpec {
	const classes = themeClasses(state.preset);
	if (target.isLink) {
		const title = target.spans[0].dataset.target ?? target.text;
		return {
			segments: LINK_TOOL_ORDER.map((id) => {
				const info = { ...LINK_TOOLS[id] };
				if (id === "peek") info.title = "Preview · linked from 3 notes";
				if (id === "unlink") info.title = `Unlink, keep “${target.text}”`;
				return segment(id, info, { ok: true });
			}),
			hub: `→ ${title}`,
			hubMuted: false,
			variant: "wha-wheel-links",
			themeClasses: classes,
		};
	}
	const segments = slotsFor(state.slots).map((id): WheelSegment => {
		if (id === "none") return { id, icon: "", label: "", description: "", enabled: false, active: false, empty: true };
		const active = FORMAT_CLASS[id] ? target.spans.every((s) => s.classList.contains(FORMAT_CLASS[id])) : false;
		if (id.startsWith("custom:")) {
			const wrapper = DEFAULT_SETTINGS.customWrappers.find((w) => `custom:${w.id}` === id)!;
			const info = { label: wrapper.name, title: `${wrapper.name}: ${wrapper.before}…${wrapper.after}`, activeTitle: `Remove ${wrapper.name.toLowerCase()}`, icon: wrapper.icon };
			return segment(id, info, { ok: true, active });
		}
		const info = BUILTIN_ACTIONS[id as keyof typeof BUILTIN_ACTIONS];
		if (id === "extract") return segment(id, info, target.selection ? { ok: true } : { ok: false, reason: "Select a passage to extract" });
		return segment(id, info, { ok: true, active });
	});
	return { segments, hub: target.text, hubMuted: false, themeClasses: classes };
}

// ---- Wheel lifecycle (mirrors src/hover-extension.ts) ------------------------------------------

let current: { target: Target; menu: HoverMenu; box: Box } | null = null;
let leaveTimer: number | null = null;
let hoverTimer: number | null = null;
let hoverSpan: HTMLElement | null = null;
let pointer: Point | null = null;

function boxOf(spans: HTMLElement[]): Box {
	const rects = spans.map((s) => s.getBoundingClientRect());
	return {
		left: Math.min(...rects.map((r) => r.left)),
		right: Math.max(...rects.map((r) => r.right)),
		top: Math.min(...rects.map((r) => r.top)),
		bottom: Math.max(...rects.map((r) => r.bottom)),
	};
}

function close(): void {
	if (leaveTimer !== null) window.clearTimeout(leaveTimer);
	leaveTimer = null;
	if (!current) return;
	current.menu.destroy();
	for (const span of current.target.spans) span.classList.remove("wha-hover-target", "wha-theme", ...PRESET_IDS.map((p) => `wha-preset-${p}`));
	current = null;
}

function open(span: HTMLElement): void {
	const target = targetFor(span);
	close();
	const menu = new HoverMenu(
		document,
		wheelFor(target),
		(id) => {
			close();
			run(id, target);
		},
		close,
	);
	const box = boxOf(target.spans);
	const singleLine = box.bottom - box.top < span.getBoundingClientRect().height * 1.6;
	menu.place(singleLine ? box : span.getBoundingClientRect());
	for (const s of target.spans) s.classList.add("wha-hover-target", ...themeClasses(state.preset));
	current = { target, menu, box };
}

function cancelHover(): void {
	if (hoverTimer !== null) window.clearTimeout(hoverTimer);
	hoverTimer = null;
	hoverSpan = null;
}

function scheduleHover(span: HTMLElement, delay: number): void {
	if (hoverSpan === span && hoverTimer !== null) return;
	cancelHover();
	hoverSpan = span;
	hoverTimer = window.setTimeout(() => {
		hoverTimer = null;
		if (!current?.target.spans.includes(span)) open(span);
	}, delay);
}

note.addEventListener("mousemove", (event) => {
	pointer = { x: event.clientX, y: event.clientY };
	const span = wordAt(event.target);
	if (event.shiftKey && span && event.buttons === 0) scheduleHover(span, HOVER_DELAY_MS);
	else if (!event.shiftKey || !span) cancelHover();
});

note.addEventListener("click", (event) => {
	const span = wordAt(event.target);
	if (span && getSelection()?.isCollapsed !== false) {
		event.preventDefault();
		open(span);
	}
});

document.addEventListener("mousemove", (event) => {
	pointer = { x: event.clientX, y: event.clientY };
	if (!current) return;
	const inside = inBox(current.box, pointer, REGION_SLACK_PX) || current.menu.contains(pointer, REGION_SLACK_PX);
	if (inside) {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
	} else if (leaveTimer === null) leaveTimer = window.setTimeout(close, LEAVE_GRACE_MS);
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Shift" && !event.repeat && pointer) {
		const span = wordAt(document.elementFromPoint(pointer.x, pointer.y));
		if (span) scheduleHover(span, KEY_HOVER_DELAY_MS);
	} else if (event.key === "Escape") {
		close();
		closeModal();
	}
});
document.addEventListener("keyup", (event) => event.key === "Shift" && cancelHover());
document.addEventListener("mousedown", (event) => {
	if (current && !current.menu.el.contains(event.target as Node) && !wordAt(event.target)) close();
});
// Screenshot mode skips these: headless browsers resize the window right after loading.
if (!params.has("shot")) {
	window.addEventListener("scroll", close, { passive: true });
	window.addEventListener("resize", close);
}

// ---- Simulated results ----------------------------------------------------------------------

function run(id: string, target: Target): void {
	if (target.isLink) return runLinkTool(id, target);
	const cls = FORMAT_CLASS[id];
	if (cls) {
		const on = !target.spans.every((s) => s.classList.contains(cls));
		for (const s of target.spans) s.classList.toggle(cls, on);
		return;
	}
	if (id === "link") return link(target, true);
	if (id === "extract") return extract(target);
	if (id === "define") return define(target.text);
}

function link(target: Target, offerFollowUps: boolean): void {
	const title = LINK_TITLES[key(target.text)] ?? target.text.charAt(0).toUpperCase() + target.text.slice(1);
	for (const s of target.spans) {
		s.classList.add("is-link");
		s.dataset.target = title;
	}
	if (!offerFollowUps) return;
	const buttons: ToastButton[] = [];
	if (!target.selection && key(target.text) !== key(title)) {
		buttons.push({ label: `Add “${target.text}” as alias`, done: `✓ Alias “${target.text}” added`, run: () => undefined });
	}
	const others = words().filter((w) => !w.classList.contains("is-link") && key(w.textContent ?? "") === key(target.text));
	if (!target.selection && others.length > 0) {
		buttons.push({
			label: `Link ${others.length} more mention${others.length === 1 ? "" : "s"}`,
			done: "✓ Linked",
			run: () => {
				for (const w of others) {
					w.classList.add("is-link");
					w.dataset.target = title;
				}
			},
		});
	}
	toast(`Linked to ${title}.`, buttons);
}

function extract(target: Target): void {
	const title = target.spans
		.slice(0, 5)
		.map((s) => s.textContent)
		.join(" ");
	const first = target.spans[0];
	const range = document.createRange();
	range.setStartAfter(first);
	range.setEndAfter(target.spans[target.spans.length - 1]);
	range.deleteContents();
	first.textContent = title;
	first.className = "w is-link";
	first.dataset.target = title;
	getSelection()?.removeAllRanges();
	toast(`Extracted to “Inbox/${title}.md”. In Obsidian, Ctrl+Z restores the passage.`, []);
}

function define(text: string): void {
	const entry = DEFINITIONS[key(text)];
	openModal(text, (body) => {
		const wiki = body.createDiv({ cls: "wha-define-section" });
		wiki.createDiv({ cls: "wha-define-heading", text: `Wikipedia · ${entry?.title ?? text}` });
		wiki.createEl("p", { text: entry?.summary ?? "In Obsidian, Define shows the Wikipedia summary for this word or phrase." });
		const dict = body.createDiv({ cls: "wha-define-section" });
		dict.createDiv({ cls: "wha-define-heading", text: "Wiktionary" });
		const list = dict.createEl("ol");
		for (const sense of entry?.senses ?? ["…and its Wiktionary definitions."]) list.createEl("li", { text: sense });
		body.createEl("p", { cls: "demo-fineprint", text: "Demo text. The plugin looks these up live, only when you click Define." });
	}, "wha-define");
}

function runLinkTool(id: string, target: Target): void {
	const span = target.spans[0];
	const title = span.dataset.target ?? target.text;
	if (id === "unlink") {
		span.classList.remove("is-link");
		delete span.dataset.target;
	} else if (id === "peek") {
		openModal(title, (body) => {
			body.createDiv({ cls: "wha-peek-meta", text: `${title}.md · linked from 3 notes` });
			const preview = body.createDiv({ cls: "wha-peek-body" });
			preview.createEl("p", { text: DEFINITIONS[key(target.text)]?.summary ?? `A note about ${title}.` });
		}, "wha-peek");
	} else {
		toast(id === "retarget" ? "In Obsidian, Change opens the note picker to point this link elsewhere." : `In Obsidian, Split opens “${title}” in a split pane.`, []);
	}
}

// ---- Toast and dialogs (same classes as the plugin) --------------------------------------------

interface ToastButton {
	label: string;
	done: string;
	run: () => void;
}

function toast(message: string, buttons: ToastButton[]): void {
	document.querySelector(".wha-toast")?.remove();
	const el = document.body.createDiv({ cls: ["wha-toast", ...themeClasses(state.preset)] });
	el.createDiv({ cls: "wha-toast-message", text: message });
	const closeButton = el.createEl("button", { cls: "wha-toast-close clickable-icon", text: "×", attr: { "aria-label": "Close" } });
	closeButton.addEventListener("click", () => el.remove());
	let timer = window.setTimeout(() => el.remove(), 9000);
	el.addEventListener("mouseenter", () => window.clearTimeout(timer));
	el.addEventListener("mouseleave", () => (timer = window.setTimeout(() => el.remove(), 4000)));
	if (buttons.length === 0) return;
	const row = el.createDiv({ cls: "wha-toast-actions" });
	for (const button of buttons) {
		const action = row.createEl("button", { cls: "mod-cta wha-btn-primary", text: button.label });
		action.addEventListener("click", () => {
			if (action.disabled) return;
			button.run();
			action.disabled = true;
			action.textContent = button.done;
			action.classList.remove("mod-cta", "wha-btn-primary");
		});
	}
}

function closeModal(): void {
	document.querySelector(".demo-modal-backdrop")?.remove();
}

function openModal(title: string, fill: (body: HTMLElement) => void, contentClass: string): void {
	closeModal();
	const backdrop = document.body.createDiv({ cls: "demo-modal-backdrop" });
	const modal = backdrop.createDiv({ cls: ["modal", "wha-glass-modal", ...themeClasses(state.preset)], attr: { role: "dialog" } });
	const closeButton = modal.createEl("button", { cls: "modal-close-button clickable-icon", text: "×", attr: { "aria-label": "Close" } });
	closeButton.addEventListener("click", closeModal);
	modal.createDiv({ cls: "modal-title", text: title });
	const body = modal.createDiv({ cls: `modal-content ${contentClass}` });
	fill(body);
	backdrop.addEventListener("mousedown", (event) => event.target === backdrop && closeModal());
}

// ---- Controls and preset gallery --------------------------------------------------------------

function applyTheme(): void {
	document.body.classList.toggle("theme-dark", state.theme === "dark");
	document.body.classList.toggle("theme-light", state.theme === "light");
}

function renderControls(): void {
	const presets = document.querySelector<HTMLElement>(".demo-presets");
	if (presets) {
		presets.replaceChildren();
		for (const id of PRESET_IDS) {
			const chip = presets.createEl("button", {
				cls: `wha-preset-chip${state.preset === id ? " is-selected" : ""}`,
				attr: { "aria-pressed": String(state.preset === id) },
			});
			chip.createSpan({ cls: ["wha-preset-swatch", ...themeClasses(id)] });
			chip.createSpan({ cls: "wha-preset-name", text: PRESETS[id].name });
			chip.addEventListener("click", () => {
				state.preset = id;
				close();
				renderControls();
			});
		}
	}
	for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
		button.setAttribute("aria-pressed", String(button.dataset.themeChoice === state.theme));
		button.onclick = () => {
			state.theme = button.dataset.themeChoice ?? "dark";
			close();
			applyTheme();
			renderControls();
		};
	}
	for (const button of document.querySelectorAll<HTMLButtonElement>("[data-slots]")) {
		button.setAttribute("aria-pressed", String(Number(button.dataset.slots) === state.slots));
		button.onclick = () => {
			state.slots = Number(button.dataset.slots) as SlotCount;
			close();
			renderControls();
		};
	}
}

function renderGallery(): void {
	const gallery = document.querySelector<HTMLElement>(".demo-gallery");
	if (!gallery) return;
	gallery.replaceChildren();
	for (const id of PRESET_IDS) {
		const figure = gallery.createEl("figure");
		const segments = slotsFor(6).map((slot, i): WheelSegment => {
			const info = BUILTIN_ACTIONS[slot as keyof typeof BUILTIN_ACTIONS];
			return { id: slot, icon: info.icon, label: info.label, description: info.title, enabled: true, active: i === 1 };
		});
		const menu = new HoverMenu(document, { segments, hub: PRESETS[id].name, hubMuted: false, themeClasses: themeClasses(id) }, () => undefined, () => undefined);
		menu.el.classList.add("is-preview");
		figure.appendChild(menu.el);
		figure.createEl("figcaption", { text: PRESETS[id].name });
	}
}

// ---- Fixed states for screenshots (?shot&open=TB&hover=link …) --------------------------------

function firstWord(text: string, linked = false): HTMLElement | undefined {
	return words().find((w) => key(w.textContent ?? "") === key(text) && w.classList.contains("is-link") === linked);
}

function applyShotParams(): void {
	if (params.has("noanim")) document.body.classList.add("no-motion");
	if (params.has("shot")) document.body.classList.add("shot");
	if (params.has("gallery")) document.body.classList.add("shot-gallery");
	for (const pair of (params.get("fmt") ?? "").split(",").filter(Boolean)) {
		const [word, action] = pair.split(":");
		firstWord(word)?.classList.add(FORMAT_CLASS[action]);
	}
	const linked = params.get("linked");
	if (linked) {
		const span = firstWord(linked);
		if (span) link({ spans: [span], text: span.textContent ?? "", isLink: false, selection: false }, params.has("toast"));
	}
	const openWord = params.get("open");
	if (openWord) {
		const span = firstWord(openWord, params.has("openlink")) ?? firstWord(openWord, true);
		if (span) open(span);
		const hover = params.get("hover");
		if (hover && current) {
			current.menu.el.querySelector(`path[data-action="${hover}"]`)?.dispatchEvent(new MouseEvent("mouseenter"));
		}
	}
	const defineWord = params.get("define");
	if (defineWord) define(defineWord);
}

tokenize(note);
applyTheme();
renderControls();
renderGallery();
window.requestAnimationFrame(applyShotParams);
