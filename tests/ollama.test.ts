import { describe, expect, it } from "vitest";
import { cleanReply, ollamaError, refusesThink } from "../src/text/ollama";

describe("ollamaError", () => {
	it("reads Ollama's message and drops its reference id", () => {
		expect(
			ollamaError({ error: "Add usage credits or subscribe and save up to 66%: https://ollama.com/plans (ref: 31e005f0-af7b-4efd-85d4-684703efaadc)" }),
		).toBe("Add usage credits or subscribe and save up to 66%: https://ollama.com/plans");
		expect(ollamaError({ error: "model 'x' not found" })).toBe("model 'x' not found");
	});

	it("is null without a message", () => {
		expect(ollamaError(null)).toBeNull();
		expect(ollamaError({})).toBeNull();
		expect(ollamaError({ error: "  " })).toBeNull();
		expect(ollamaError("not json")).toBeNull();
	});
});

describe("refusesThink", () => {
	it("spots a model that doesn't take the think option", () => {
		expect(refusesThink('"llama3.2" does not support thinking')).toBe(true);
		expect(refusesThink("think value \"high\" is not supported for this model")).toBe(true);
		expect(refusesThink("model 'x' not found")).toBe(false);
		expect(refusesThink(null)).toBe(false);
	});
});

describe("cleanReply", () => {
	it("removes reasoning, a chatty preface, and quotes around the answer", () => {
		expect(cleanReply('<think>plan it</think>\nHere is the shortened passage:\n"Cells divide."')).toBe("Cells divide.");
	});
});
