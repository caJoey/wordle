import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGuess, isValidGuess, isAnswerWord, answerWords } from "../shared/wordle";
import wordList from "../shared/words_5";

const ev = (guess: string, answer: string) => evaluateGuess(guess, answer).join("");

test("all green when guess equals answer", () => {
	assert.equal(ev("crane", "crane"), "🟩🟩🟩🟩🟩");
});

test("all gray when no letters match", () => {
	assert.equal(ev("lumpy", "abide"), "⬛⬛⬛⬛⬛");
});

test("repeated letters: abbey vs bobby", () => {
	// b(0) yellow (answer has two b: one used by the green at 2), b(3) gray, y green
	assert.equal(ev("bobby", "abbey"), "🟨⬛🟩⬛🟩");
});

test("repeated guess letter with a single answer letter: speed vs abide", () => {
	// first e is yellow (answer's one e), second e gray; d is yellow
	assert.equal(ev("speed", "abide"), "⬛⬛🟨⬛🟨");
});

test("three of a letter vs answer with one: green wins over earlier copies", () => {
	assert.equal(ev("eerie", "abide"), "⬛⬛⬛🟨🟩");
	assert.equal(ev("geese", "crane"), "⬛⬛⬛⬛🟩");
});

test("three of a letter vs answer with one: only the first copy is yellow", () => {
	assert.equal(ev("eerie", "ocean"), "🟨⬛⬛⬛⬛");
});

test("isValidGuess accepts answer words and guess-only words", () => {
	assert.equal(isValidGuess("crane"), true);
	assert.equal(isValidGuess("aahed"), true);
});

test("isValidGuess is case-sensitive (callers lowercase first)", () => {
	assert.equal(isValidGuess("CRANE"), false);
});

test("isValidGuess rejects wrong length and unknown words", () => {
	assert.equal(isValidGuess("cran"), false);
	assert.equal(isValidGuess("cranes"), false);
	assert.equal(isValidGuess(""), false);
	assert.equal(isValidGuess("zzzzz"), false);
});

test("isAnswerWord / answerWords", () => {
	assert.equal(answerWords.length, new Set([...wordList.words, ...wordList.valid]).size);
	assert.equal(isAnswerWord("crane"), true);
	assert.equal(isAnswerWord("aahed"), true);
});
