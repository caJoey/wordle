import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { LetterState } from "../../shared/protocol";
import { evaluateGuess } from "../../shared/wordle";
import { botGuess, buildBotPrompt, parseBotWord } from "../words/bot";
import { setFetch } from "../words/gemma";

process.env.GEMMA_API = "test-key";
process.env.GEMMA_MOCK = "0";

const clue = (word: string, answer: string, hideGrays = false) => ({
	word,
	colors: evaluateGuess(word, answer).map((c): LetterState => (hideGrays && c === "⬛" ? "🔳" : c)),
});

/** Fake Gemma: replies in order, recording each prompt. */
function fakeGemma(...replies: string[]) {
	const prompts: string[] = [];
	setFetch(async (_url, init) => {
		prompts.push(JSON.parse(String(init.body)).contents[0].parts[0].text);
		const text = JSON.stringify({ word: replies[Math.min(prompts.length - 1, replies.length - 1)] });
		return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
	});
	return prompts;
}

after(() => setFetch());

describe("bot prompt", () => {
	it("contains no word list and stays small", () => {
		const p = buildBotPrompt({ theme: "the ocean", history: [clue("shark", "whale"), clue("coral", "whale")] });
		assert.ok(p.length < 1200, `prompt is ${p.length} chars`);
		assert.doesNotMatch(p, /choose from|cigar|rebut/i);
		assert.match(p, /<theme>the ocean<\/theme>/);
	});

	it("summarises what the clues mean", () => {
		const p = buildBotPrompt({ history: [clue("trace", "crane")] }); // ⬛🟩🟩🟨🟩
		assert.match(p, /Known positions: _ R A _ E/);
		assert.match(p, /C \(not 4\)/);
		assert.match(p, /Not in the word: T/);
		assert.doesNotMatch(p, /<theme>/, "no theme unless given");
	});

	it("easy bots, with grays hidden, are not told which letters are absent", () => {
		const p = buildBotPrompt({ history: [clue("trace", "crane", true)] });
		assert.doesNotMatch(p, /Not in the word/);
		assert.match(p, /TRACE \?GGYG/);
	});

	it("a letter gray in one spot but green elsewhere is not listed as absent", () => {
		const p = buildBotPrompt({ history: [clue("geese", "these")] }); // ⬛⬛🟩🟩🟩 duplicate e
		assert.doesNotMatch(p, /Not in the word: .*E/);
	});

	it("parses JSON or a bare word", () => {
		assert.equal(parseBotWord('{"word": "Crane"}'), "crane");
		assert.equal(parseBotWord("I guess SLATE."), "slate");
		assert.equal(parseBotWord("no idea"), undefined);
	});
});

describe("botGuess", () => {
	it("returns a real word on the first try (one call)", async () => {
		const prompts = fakeGemma("crane");
		assert.equal(await botGuess({ history: [] }), "crane");
		assert.equal(prompts.length, 1);
	});

	it("retries once, naming the rejected word, then gives up", async () => {
		let prompts = fakeGemma("zzzzz", "slate");
		assert.equal(await botGuess({ history: [] }), "slate");
		assert.equal(prompts.length, 2);
		assert.match(prompts[1], /not allowed.*zzzzz/);

		prompts = fakeGemma("crane", "crane");
		assert.equal(await botGuess({ history: [clue("crane", "whale")] }), undefined, "repeat guess rejected twice");
		assert.equal(prompts.length, 2);
	});
});
