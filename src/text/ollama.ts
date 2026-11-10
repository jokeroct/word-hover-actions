/** Removes wrappers that chat models sometimes add despite being asked not to. */
export function cleanReply(reply: string): string {
	return reply
		.replace(/<think>[\s\S]*?<\/think>/g, "")
		.trim()
		.replace(/^(?:here(?:'s| is) (?:the |a )?(?:shortened|shorter|condensed) (?:passage|version|text)[^:\n]*:\s*)/i, "")
		.replace(/^"([\s\S]*)"$/, "$1")
		.trim();
}

/**
 * The message in an Ollama error answer (`{ "error": "…" }`), without the reference id it may
 * end with, e.g. "(ref: 31e0…)". Null when there is none.
 */
export function ollamaError(json: unknown): string | null {
	const error = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
	if (typeof error !== "string") return null;
	const message = error.replace(/\s*\(ref: [^)]*\)\s*$/, "").trim();
	return message || null;
}

/** Whether an error says the model doesn't take the `think` option, so the request is sent without it. */
export const refusesThink = (message: string | null) => message !== null && /\bthink/i.test(message);
