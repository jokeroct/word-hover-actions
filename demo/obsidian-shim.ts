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
