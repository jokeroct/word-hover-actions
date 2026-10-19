// Stand-in for the parts of the `obsidian` module the wheel uses, so the demo page can run the
// plugin's real menu code in a browser. Icons are the same Lucide set Obsidian ships.
import {
	BookOpen,
	Bold,
	Brackets,
	Eye,
	FileOutput,
	Highlighter,
	type IconNode,
	Italic,
	Link,
	MessageSquare,
	Replace,
	SeparatorVertical,
	Sigma,
	Strikethrough,
	Unlink,
	X,
	createElement,
} from "lucide";

const ICONS: Record<string, IconNode> = {
	"book-open": BookOpen,
	bold: Bold,
	brackets: Brackets,
	eye: Eye,
	"file-output": FileOutput,
	highlighter: Highlighter,
	italic: Italic,
	link: Link,
	"message-square": MessageSquare,
	replace: Replace,
	"separator-vertical": SeparatorVertical,
	sigma: Sigma,
	strikethrough: Strikethrough,
	unlink: Unlink,
	x: X,
};

export function setIcon(parent: HTMLElement, iconId: string): void {
	parent.replaceChildren();
	const node = ICONS[iconId];
	if (node) parent.appendChild(createElement(node, { class: `svg-icon lucide-${iconId}` }));
}

// Obsidian adds DOM helpers to every window and node (createEl, createDiv, createSvg, …). The wheel
// and the demo build their markup with them, so these follow Obsidian's behavior closely enough.
// Being their implementation, this is the one place that calls the native DOM methods directly.
function build<T extends Element>(
	el: T,
	o: DomElementInfo | SvgElementInfo | string | undefined,
	callback: ((el: T) => void) | undefined,
): T {
	const info: DomElementInfo = typeof o === "string" ? { cls: o } : (o ?? {});
	if (info.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(" ").filter(Boolean)));
	if (info.text) el.append(info.text);
	for (const [name, value] of Object.entries(info.attr ?? {})) if (value !== null) el.setAttribute(name, String(value));
	callback?.(el);
	if (info.parent) {
		if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
		else info.parent.appendChild(el);
	}
	return el;
}

window.createEl = (tag, o, callback) => build(document.createElement(tag), o, callback);
window.createDiv = (o, callback) => createEl("div", o, callback);
window.createSpan = (o, callback) => createEl("span", o, callback);
window.createSvg = (tag, o, callback) => build(document.createElementNS("http://www.w3.org/2000/svg", tag), o, callback);
window.createFragment = (callback) => {
	const fragment = document.createDocumentFragment();
	callback?.(fragment);
	return fragment;
};

const withParent = <O extends DomElementInfo | SvgElementInfo>(parent: Node, o: O | string | undefined): O =>
	({ ...(typeof o === "string" ? { cls: o } : o), parent }) as O;

Node.prototype.createEl = function (this: Node, tag, o, callback) {
	return createEl(tag, withParent(this, o), callback);
};
Node.prototype.createDiv = function (this: Node, o, callback) {
	return createDiv(withParent(this, o), callback);
};
Node.prototype.createSpan = function (this: Node, o, callback) {
	return createSpan(withParent(this, o), callback);
};
Node.prototype.createSvg = function (this: Node, tag, o, callback) {
	return createSvg(tag, withParent(this, o), callback);
};
Node.prototype.instanceOf = function <T>(this: Node, type: { new (): T }): this is T {
	return this instanceof type;
};
