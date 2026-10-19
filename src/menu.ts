import { setIcon } from "obsidian";

/** A rectangle in viewport (client) coordinates. */
export interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface Point {
	x: number;
	y: number;
}

export function inBox(box: Box, p: Point, slack = 0): boolean {
	return p.x >= box.left - slack && p.x <= box.right + slack && p.y >= box.top - slack && p.y <= box.bottom + slack;
}

/** One ring segment. Segments are laid out clockwise from the top. */
export interface WheelSegment {
	id: string;
	icon: string;
	label: string;
	/** Shown in the center while the segment is hovered: its full name, or why it's unavailable. */
	description: string;
	enabled: boolean;
	/** The formatting is already applied (drawn in a stronger tint). */
	active: boolean;
	/** An unused slot: drawn faintly, without icon or label. */
	empty?: boolean;
}

export interface WheelSpec {
	segments: WheelSegment[];
	/** Default center text: the hovered word, a link target, or why everything is unavailable. */
	hub: string;
	hubMuted: boolean;
	/** Extra class for variants such as the link-tools wheel. */
	variant?: string;
	/** Theme and color-preset classes (see theme.ts). */
	themeClasses: string[];
}

interface Geometry {
	size: number;
	rOut: number;
	rIn: number;
	hubR: number;
}

// Larger wheels keep each segment wide enough for its label.
const GEOMETRY: Record<number, Geometry> = {
	4: { size: 184, rOut: 86, rIn: 38, hubR: 31 },
	6: { size: 200, rOut: 94, rIn: 44, hubR: 37 },
	8: { size: 224, rOut: 106, rIn: 52, hubR: 45 },
};
// Segments are drawn inset by CORNER and stroked with a round join of width 2 × CORNER in the
// same color, which rounds their corners.
const CORNER = 4;
const SEGMENT_GAP = 5;
const SIDE_GAP_PX = 8;
const EDGE_MARGIN_PX = 8;
/** Keeps gradient ids unique when several wheels exist (e.g. in popout windows). */
let gradientCounter = 0;

function geometryFor(count: number): Geometry {
	return GEOMETRY[count] ?? (count <= 4 ? GEOMETRY[4] : count <= 6 ? GEOMETRY[6] : GEOMETRY[8]);
}

/** A ring segment centred on `center` (radians) spanning `span`, with a constant-width gap to its neighbours. */
function segmentPath(center: number, span: number, g: Geometry): string {
	const half = span / 2;
	const offset = SEGMENT_GAP / 2 + CORNER;
	const outer = g.rOut - CORNER;
	const inner = g.rIn + CORNER;
	const edge = (r: number, side: 1 | -1) => center + side * (half - Math.asin(offset / r));
	const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
	return [
		`M ${pt(outer, edge(outer, -1))}`,
		`A ${outer} ${outer} 0 0 1 ${pt(outer, edge(outer, 1))}`,
		`L ${pt(inner, edge(inner, 1))}`,
		`A ${inner} ${inner} 0 0 0 ${pt(inner, edge(inner, -1))}`,
		"Z",
	].join(" ");
}

/**
 * The radial action menu: ring segments around a hub that shows the hovered text, the hovered
 * segment's full name, or why it is unavailable. It never takes focus, so the editor keeps its
 * cursor and selection.
 */
export class HoverMenu {
	readonly el: HTMLElement;
	private rect: Box | null = null;
	private readonly hubText: HTMLElement;
	private readonly size: number;

	constructor(
		private readonly doc: Document,
		spec: WheelSpec,
		onAction: (id: string) => void,
		onClose: () => void,
	) {
		const count = spec.segments.length;
		const g = geometryFor(count);
		this.size = g.size;
		// Created in the window that will show it (the editor may be in a popout), and attached in place().
		this.el = (doc.defaultView ?? window).createDiv({
			// The size class sets the wheel's dimensions in styles.css (sizes match GEOMETRY).
			cls: [
				"word-hover-actions-menu",
				"wha-wheel",
				`wha-wheel-${g.size === GEOMETRY[4].size ? 4 : g.size === GEOMETRY[6].size ? 6 : 8}`,
				...spec.themeClasses,
				...(spec.variant ? [spec.variant] : []),
			],
			attr: { role: "menu" },
		});
		// Keep focus and selection in the editor when the wheel is clicked.
		this.el.addEventListener("mousedown", (event) => event.preventDefault());

		const svg = this.el.createSvg("svg", {
			cls: "wha-wheel-svg",
			attr: { viewBox: `${-g.size / 2} ${-g.size / 2} ${g.size} ${g.size}`, width: g.size, height: g.size },
		});
		const { glass, accent } = this.addGradients(svg, g);

		const hub = svg.createSvg("circle", { cls: "wha-wheel-hub", attr: { r: g.hubR, "aria-label": "Close" } });
		hub.addEventListener("click", (event) => {
			event.preventDefault();
			onClose();
		});

		const span = (2 * Math.PI) / count;
		const mid = (g.rIn + g.rOut) / 2;
		spec.segments.forEach((segment, i) => {
			const angle = -Math.PI / 2 + i * span;
			const d = segmentPath(angle, span, g);
			// A glass base that takes the pointer, and an accent overlay that fades in on hover.
			const group = svg.createSvg("g", { cls: "wha-seg" });
			group.style.setProperty("--i", String(i));
			const base = group.createSvg("path", {
				cls: "wha-wheel-seg",
				attr: { d, fill: `url(#${glass})`, stroke: `url(#${glass})`, "data-action": segment.id },
			});
			if (segment.empty) {
				group.classList.add("is-empty");
				return;
			}
			group.createSvg("path", { cls: "wha-seg-fill", attr: { d, fill: `url(#${accent})`, stroke: `url(#${accent})` } });
			base.setAttribute("role", "menuitem");
			base.setAttribute("aria-label", segment.description);

			const label = this.el.createDiv({ cls: "wha-wheel-label" });
			label.style.setProperty("--i", String(i));
			label.style.left = `${g.size / 2 + mid * Math.cos(angle)}px`;
			label.style.top = `${g.size / 2 + mid * Math.sin(angle)}px`;
			setIcon(label.createSpan({ cls: "wha-wheel-icon" }), segment.icon);
			label.createSpan({ text: segment.label });

			for (const el of [group, label]) {
				if (segment.active) el.classList.add("is-active");
				if (!segment.enabled) el.classList.add("is-disabled");
			}
			if (segment.active) base.setAttribute("aria-pressed", "true");
			if (!segment.enabled) base.setAttribute("aria-disabled", "true");

			base.addEventListener("mouseenter", () => {
				group.classList.add("is-hovered");
				label.classList.add("is-hovered");
				this.el.classList.toggle("has-hover", segment.enabled);
				this.showHub(segment.description, !segment.enabled);
			});
			base.addEventListener("mouseleave", () => {
				group.classList.remove("is-hovered");
				label.classList.remove("is-hovered");
				this.el.classList.remove("has-hover");
				this.showHub(spec.hub, spec.hubMuted);
			});
			base.addEventListener("click", (event) => {
				event.preventDefault();
				if (segment.enabled) onAction(segment.id);
			});
		});

		this.hubText = this.el.createDiv({ cls: "wha-wheel-center" });
		this.showHub(spec.hub, spec.hubMuted);
	}

	/**
	 * Gradients whose colors come from CSS variables, so presets and light/dark themes restyle
	 * the wheel without new markup. Glass is lit from the top of the whole wheel; the accent
	 * runs diagonally across each segment.
	 */
	private addGradients(svg: SVGElement, g: Geometry): { glass: string; accent: string } {
		const id = `wha-${++gradientCounter}`;
		const defs = svg.createSvg("defs");
		const gradient = (name: string, stops: string[], attrs: Record<string, string>) => {
			const el = defs.createSvg("linearGradient", { attr: { id: `${id}-${name}`, ...attrs } });
			stops.forEach((cls, i) => el.createSvg("stop", { cls, attr: { offset: i / (stops.length - 1) } }));
			return el.id;
		};
		return {
			glass: gradient("glass", ["wha-stop-glass-top", "wha-stop-glass-bottom"], {
				gradientUnits: "userSpaceOnUse",
				x1: "0",
				y1: String(-g.rOut),
				x2: "0",
				y2: String(g.rOut),
			}),
			accent: gradient("accent", ["wha-stop-accent-1", "wha-stop-accent-2"], { x1: "0", y1: "0", x2: "1", y2: "1" }),
		};
	}

	private showHub(text: string, muted: boolean): void {
		this.hubText.textContent = text;
		this.hubText.classList.toggle("is-muted", muted);
	}

	/**
	 * Shows the wheel beside the target: to its right, vertically centred on the hovered line,
	 * or to its left when there is no room on the right.
	 */
	place(anchor: Box): void {
		const win = this.doc.defaultView ?? window;
		const size = this.size;
		let left = anchor.right + SIDE_GAP_PX;
		let fromLeft = true;
		if (left + size > win.innerWidth - EDGE_MARGIN_PX) {
			left = anchor.left - SIDE_GAP_PX - size;
			fromLeft = false;
		}
		left = Math.max(EDGE_MARGIN_PX, Math.min(left, win.innerWidth - size - EDGE_MARGIN_PX));
		const middle = (anchor.top + anchor.bottom) / 2;
		const top = Math.max(EDGE_MARGIN_PX, Math.min(middle - size / 2, win.innerHeight - size - EDGE_MARGIN_PX));
		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
		this.el.classList.add(fromLeft ? "wha-grow-right" : "wha-grow-left");
		this.doc.body.appendChild(this.el);
		this.rect = { left, top, right: left + size, bottom: top + size };
	}

	/** The wheel's on-screen box, once placed. */
	get box(): Box | null {
		return this.rect;
	}

	contains(p: Point, slack: number): boolean {
		return this.rect !== null && inBox(this.rect, p, slack);
	}

	destroy(): void {
		this.el.remove();
	}
}
