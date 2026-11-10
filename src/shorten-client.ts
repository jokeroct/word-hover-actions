import { type RequestUrlResponse, requestUrl } from "obsidian";
import { cleanReply, ollamaError, refusesThink } from "./text/ollama";
import type { ShortenStyle } from "./text/shorten";

/** What the reply should look like, for each style. */
const SHAPES: Record<ShortenStyle, { task: string; reply: string }> = {
	paragraph: {
		task: "Shorten the following passage",
		reply: "Reply with the shortened passage only, with no introduction or quotes around it.",
	},
	bullets: {
		task: "Summarize the following passage as short bullet points",
		reply: 'Reply with the bullet points only, one per line, each starting with "- ", with no introduction.',
	},
	numbered: {
		task: "Summarize the following passage as numbered steps, in order",
		reply: 'Reply with the steps only, one per line, numbered "1.", "2.", and so on, with no introduction.',
	},
};

function prompt(text: string, ratio: number, style: ShortenStyle): string {
	const shape = SHAPES[style];
	// Small models keep to a word count far better than to a percentage.
	const words = Math.max(5, Math.round((text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) * ratio));
	return [
		`${shape.task}, in about ${words} words (about ${Math.round(ratio * 100)}% of its length).`,
		"Keep its meaning, key facts, names, and numbers, and don't add anything that isn't in it.",
		"Keep any Markdown that stays, such as [[links]], **bold**, and ==highlights==.",
		shape.reply,
		"",
		"Passage:",
		text,
	].join("\n");
}

/** How long to wait for an answer before showing the built-in version instead. */
const TIMEOUT_MS = 60_000;

type Body = Record<string, unknown>;

async function generate(baseUrl: string, body: Body): Promise<RequestUrlResponse> {
	try {
		return await requestUrl({
			url: `${baseUrl}/api/generate`,
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify(body),
			throw: false,
		});
	} catch {
		throw new Error(`Couldn't reach Ollama at ${baseUrl}. Is it running?`);
	}
}

function jsonOf(response: RequestUrlResponse): unknown {
	try {
		return response.json as unknown;
	} catch {
		return null;
	}
}

/** Rejects with `message` if `promise` hasn't settled after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

async function ask(text: string, ratio: number, baseUrl: string, model: string, style: ShortenStyle): Promise<string> {
	const body: Body = { model, prompt: prompt(text, ratio, style), stream: false };
	// Shortening needs no reasoning, and models that "think" first can take minutes to answer.
	let response = await generate(baseUrl, { ...body, think: false });
	if (response.status === 400 && refusesThink(ollamaError(jsonOf(response)))) response = await generate(baseUrl, body);
	if (response.status === 404) throw new Error(`Ollama doesn't have the model “${model}” (run “ollama pull ${model}”).`);
	if (response.status !== 200) {
		const message = ollamaError(jsonOf(response));
		throw new Error(message ? `Ollama: ${message}` : `Ollama answered with an error (${response.status}).`);
	}
	const reply = (jsonOf(response) as { response?: unknown } | null)?.response;
	const shortened = typeof reply === "string" ? cleanReply(reply) : "";
	if (!shortened) throw new Error("Ollama sent back an empty answer.");
	return shortened;
}

/**
 * Asks an Ollama server (by default on this computer) to rewrite `text` shorter. Only called when
 * the user has chosen the local AI in settings. Throws with a readable message when it can't,
 * including when it takes more than a minute.
 */
export async function shortenWithOllama(
	text: string,
	ratio: number,
	baseUrl: string,
	model: string,
	style: ShortenStyle = "paragraph",
): Promise<string> {
	return withTimeout(ask(text, ratio, baseUrl, model, style), TIMEOUT_MS, `${model} took more than a minute to answer.`);
}
