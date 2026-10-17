import wordList from "./words_5";
import { COLS, type LetterState } from "./protocol";

export const answerWords: readonly string[] = [...new Set([...wordList.words, ...wordList.valid])];
const ANSWERS = new Set(answerWords);
const GUESSABLE = ANSWERS;

export function isAnswerWord(word: string) {
	return ANSWERS.has(word);
}

/** Every word from either bundled list can be guessed and selected as an answer. */
export function isValidGuess(word: string) {
	return word.length === COLS && GUESSABLE.has(word);
}

/** Score a guess against the answer, handling repeated letters the way Wordle does. */
export function evaluateGuess(guess: string, answer: string): LetterState[] {
	const remaining = answer.split("");
	const result = Array<LetterState>(COLS).fill("⬛");
	for (let i = 0; i < COLS; ++i) {
		if (guess[i] === answer[i]) {
			result[i] = "🟩";
			remaining[i] = "$";
		}
	}
	for (let i = 0; i < COLS; ++i) {
		if (result[i] === "🟩") continue;
		const pos = remaining.indexOf(guess[i]);
		if (pos >= 0) {
			result[i] = "🟨";
			remaining[pos] = "$";
		}
	}
	return result;
}
