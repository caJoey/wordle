import { COLS, ROWS, type LetterState } from "../shared/protocol";

export { COLS, ROWS };

export const keys = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** Delay between each tile flipping when a row is revealed. */
export const DELAY_INCREMENT = 200;

export const PRAISE = [
	"Genius",
	"Magnificent",
	"Impressive",
	"Splendid",
	"Great",
	"Phew",
];

/** Each lobby seat's color, for avatars and stadium meters. */
export const SEAT_COLORS = ["#538d4e", "#b59f3b", "#4a7fc1", "#b0508f"];

export type GameBoard = {
	words: string[],
	state: LetterState[][],
};

export type LetterStates = Record<string, LetterState>;

/** An empty board: no words, every tile unrevealed. */
export function emptyBoard(): GameBoard {
	return {
		words: Array(ROWS).fill(""),
		state: Array.from({ length: ROWS }, () => Array<LetterState>(COLS).fill("🔳")),
	};
}

const RANK: Record<LetterState, number> = { "🔳": 0, "⬛": 1, "🟨": 2, "🟩": 3 };

/** The best known state of every letter on the keyboard, from the guessed rows of a board. */
export function letterStates(words: string[], colors: LetterState[][]): LetterStates {
	const states: LetterStates = {};
	for (const c of "abcdefghijklmnopqrstuvwxyz") states[c] = "🔳";
	colors.forEach((row, r) => {
		const word = words[r] ?? "";
		row.forEach((state, i) => {
			const char = word[i];
			if (char && RANK[state] > RANK[states[char]]) states[char] = state;
		});
	});
	return states;
}

export function isSolvedRow(row?: LetterState[]) {
	return !!row && row.length === COLS && row.every((s) => s === "🟩");
}

export function ordinal(n: number) {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	switch (n % 10) {
		case 1: return `${n}st`;
		case 2: return `${n}nd`;
		case 3: return `${n}rd`;
		default: return `${n}th`;
	}
}

/** Format milliseconds as seconds with one decimal place, e.g. 12.3s */
export function formatSeconds(ms: number) {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a number of seconds as m:ss */
export function formatClock(seconds: number) {
	const s = Math.max(0, Math.ceil(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const area = document.createElement("textarea");
		area.value = text;
		document.body.appendChild(area);
		area.select();
		const ok = document.execCommand("copy");
		area.remove();
		return ok;
	}
}

/** True when a keyboard event comes from a place the user is typing text, so game input should ignore it. */
export function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
