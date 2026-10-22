import { requestUrl } from "obsidian";

function prompt(text: string, ratio: number): string {
	return [
		`Shorten the following passage to about ${Math.round(ratio * 100)}% of its length.`,
		"Keep its meaning, key facts, names, and numbers, and don't add anything that isn't in it.",
		"Keep any Markdown that stays, such as [[links]], **bold**, and ==highlights==.",
		"Reply with the shortened passage only, with no introduction or quotes around it.",
		"",
		"Passage:",
		text,
	].join("\n");
}

/** Removes wrappers that chat models sometimes add despite being asked not to. */
function clean(reply: string): string {
	return reply
		.replace(/<think>[\s\S]*?<\/think>/g, "")
		.trim()
		.replace(/^(?:here(?:'s| is) (?:the |a )?(?:shortened|shorter|condensed) (?:passage|version|text)[^:\n]*:\s*)/i, "")
		.replace(/^"([\s\S]*)"$/, "$1")
		.trim();
}

/**
 * Asks an Ollama server (by default on this computer) to rewrite `text` shorter. Only called when
 * the user has chosen the local AI in settings. Throws with a readable message when it can't.
 */
export async function shortenWithOllama(text: string, ratio: number, baseUrl: string, model: string): Promise<string> {
	let response;
	try {
		response = await requestUrl({
			url: `${baseUrl}/api/generate`,
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({ model, prompt: prompt(text, ratio), stream: false }),
			throw: false,
		});
	} catch {
		throw new Error(`Couldn't reach Ollama at ${baseUrl}. Is it running?`);
	}
	if (response.status === 404) throw new Error(`Ollama doesn't have the model “${model}” (run “ollama pull ${model}”).`);
	if (response.status !== 200) throw new Error(`Ollama answered with an error (${response.status}).`);
	let json: { response?: unknown } | null = null;
	try {
		json = response.json as { response?: unknown } | null;
	} catch {
		// Not JSON: treated as an empty answer below.
	}
	const reply = json?.response;
	const shortened = typeof reply === "string" ? clean(reply) : "";
	if (!shortened) throw new Error("Ollama sent back an empty answer.");
	return shortened;
}
