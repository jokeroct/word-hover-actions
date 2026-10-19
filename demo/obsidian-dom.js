// Stand-ins for the DOM helpers Obsidian adds to every window and node (createEl, createDiv,
// createSpan, createSvg, createFragment, instanceOf), so the demo page can run the plugin's real
// wheel code in a browser. Being their implementation, this file has to call the native DOM methods
// that Obsidian's lint rules steer plugin code away from. Those rules need TypeScript type
// information, which is why this one file is plain JavaScript. None of it is part of the plugin.

function build(el, o, callback) {
	const info = typeof o === "string" ? { cls: o } : (o ?? {});
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

const withParent = (parent, o) => ({ ...(typeof o === "string" ? { cls: o } : o), parent });

Node.prototype.createEl = function (tag, o, callback) {
	return createEl(tag, withParent(this, o), callback);
};
Node.prototype.createDiv = function (o, callback) {
	return createDiv(withParent(this, o), callback);
};
Node.prototype.createSpan = function (o, callback) {
	return createSpan(withParent(this, o), callback);
};
Node.prototype.createSvg = function (tag, o, callback) {
	return createSvg(tag, withParent(this, o), callback);
};
Node.prototype.instanceOf = function (type) {
	return this instanceof type;
};
