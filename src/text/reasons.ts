/** Short, user-facing explanations shown in the menu when an action is unavailable. */
export const REASON = {
	multiline: "Selection spans several lines",
	frontmatter: "Inside properties",
	codeBlock: "Inside a code block",
	inlineCode: "Inside inline code",
	code: "Inside code",
	math: "Inside math",
	link: "Already a link",
	tag: "Part of a tag",
	linkChars: "Text contains [ ] or |",
} as const;
