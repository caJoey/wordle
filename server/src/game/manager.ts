import { MAX_GUESSES, WORD_LENGTH } from "../../../shared/multiplayer.js";
import type { GameSnapshot, RoundDuration } from "../../../shared/multiplayer.js";
import type { Lobby, Player } from "./types.js";

const lobbies = new Map<string, Lobby>();

export function createLobby(host: Player, maxPlayers: number): Lobby {
	let code: string;
	do {
		code = String(Math.floor(100000 + Math.random() * 900000));
	} while (lobbies.has(code));

	const lobby: Lobby = {
		code,
		maxPlayers,
		players: [host],
		phase: "lobby",
		theme: null,
		themePickerIndex: 0,
		durationMinutes: 5,
		endsAt: null,
		answer: null,
		winnerId: null,
	};

	lobbies.set(code, lobby);
	return lobby;
}

export function findLobby(code: string): Lobby | undefined {
	return lobbies.get(code);
}

export function joinLobby(lobby: Lobby, player: Player): void {
	if (lobby.phase !== "lobby") {
		throw new Error("This round has already started.");
	}
	if (lobby.players.length >= lobby.maxPlayers) {
		throw new Error("This lobby is full.");
	}

	lobby.players.push(player);
}

export function removePlayer(lobby: Lobby, socketId: string): void {
	const removedIndex = lobby.players.findIndex((player) => player.socketId === socketId);
	lobby.players = lobby.players.filter((player) => player.socketId !== socketId);

	if (lobby.players.length === 0) {
		clearTimeout(lobby.timer);
		lobbies.delete(lobby.code);
		return;
	}

	if (!lobby.players.some((player) => player.isHost)) {
		lobby.players[0].isHost = true;
	}
	if (removedIndex >= 0 && removedIndex < lobby.themePickerIndex) {
		lobby.themePickerIndex--;
	}
	lobby.themePickerIndex %= lobby.players.length;
}

export function pickerId(lobby: Lobby): string | null {
	return lobby.players[lobby.themePickerIndex]?.id || null;
}

export function setTheme(lobby: Lobby, player: Player, theme: string): void {
	if (lobby.phase !== "lobby" || pickerId(lobby) !== player.id) {
		throw new Error("Only the current theme picker can set the theme.");
	}
	if (!theme.trim() || theme.length > 80) {
		throw new Error("Theme must be between 1 and 80 characters.");
	}

	lobby.theme = theme.trim();
}

export function evaluateGuess(guess: string, answer: string): string[] {
	const result = Array(WORD_LENGTH).fill("⬛");
	const remainingLetters = answer.split("");

	// Mark exact matches first so duplicate letters are scored correctly.
	for (let i = 0; i < WORD_LENGTH; i++) {
		if (guess[i] === answer[i]) {
			result[i] = "🟩";
			remainingLetters[i] = "";
		}
	}

	// Match any remaining letters, accounting for duplicates in the answer.
	for (let i = 0; i < WORD_LENGTH; i++) {
		if (result[i] === "🟩") continue;

		const answerIndex = remainingLetters.indexOf(guess[i]);
		if (answerIndex >= 0) {
			result[i] = "🟨";
			remainingLetters[answerIndex] = "";
		}
	}

	return result;
}

export function startRound(lobby: Lobby, answer: string, duration: RoundDuration): void {
	if (lobby.phase !== "lobby" || !lobby.theme) {
		throw new Error("Choose a theme before starting.");
	}

	lobby.answer = answer;
	lobby.durationMinutes = duration;
	lobby.phase = "playing";
	lobby.winnerId = null;
	lobby.endsAt = duration === null ? null : Date.now() + duration * 60_000;

	for (const player of lobby.players) {
		player.guesses = [];
		player.guessResults = [];
		player.status = "playing";
		player.ready = false;
		player.solvedAt = undefined;
	}
}

export function submitGuess(lobby: Lobby, player: Player, input: string): void {
	const guess = input.trim().toLowerCase();
	if (lobby.phase !== "playing" || player.status !== "playing") {
		throw new Error("You cannot guess right now.");
	}
	if (!/^[a-z]{5}$/.test(guess)) {
		throw new Error("Guess must be five letters.");
	}
	if (player.guesses.length >= MAX_GUESSES) {
		throw new Error("You have used all six guesses.");
	}
	if (Date.now() >= (lobby.endsAt ?? Infinity)) {
		finishRound(lobby);
		throw new Error("Time is up.");
	}

	player.guesses.push(guess);
	player.guessResults.push(evaluateGuess(guess, lobby.answer!));

	if (guess === lobby.answer) {
		player.status = "solved";
		player.solvedAt = Date.now();
	} else if (player.guesses.length === MAX_GUESSES) {
		player.status = "unsolved";
	}

	if (lobby.players.every((candidate) => candidate.status !== "playing")) {
		finishRound(lobby);
	}
}

export function finishRound(lobby: Lobby): void {
	if (lobby.phase !== "playing") return;

	for (const player of lobby.players) {
		if (player.status === "playing") player.status = "unsolved";
	}

	const solvedPlayers = lobby.players
		.filter((player) => player.status === "solved")
		.sort((a, b) => {
			const guessDifference = a.guesses.length - b.guesses.length;
			if (guessDifference !== 0) return guessDifference;
			return (a.solvedAt || 0) - (b.solvedAt || 0);
		});

	lobby.winnerId = solvedPlayers[0]?.id || null;
	lobby.phase = "results";
	lobby.endsAt = null;
	clearTimeout(lobby.timer);
}

export function readyForNextRound(lobby: Lobby, player: Player, ready: boolean): void {
	if (lobby.phase !== "results") return;
	player.ready = ready;

	if (!lobby.players.every((candidate) => candidate.ready)) return;

	lobby.phase = "lobby";
	lobby.theme = null;
	lobby.themePickerIndex = (lobby.themePickerIndex + 1) % lobby.players.length;
	for (const candidate of lobby.players) {
		candidate.ready = false;
		candidate.status = "waiting";
		candidate.guesses = [];
		candidate.guessResults = [];
	}
}

export function snapshot(lobby: Lobby): GameSnapshot {
	const state: GameSnapshot = {
		code: lobby.code,
		maxPlayers: lobby.maxPlayers,
		phase: lobby.phase,
		players: lobby.players.map(({ socketId: _socketId, ...player }) => ({ ...player })),
		theme: lobby.theme,
		themePickerId: pickerId(lobby),
		durationMinutes: lobby.durationMinutes,
		endsAt: lobby.endsAt,
		winnerId: lobby.winnerId,
	};

	// Keep the answer private until the results phase.
	if (lobby.phase === "results") {
		state.answer = lobby.answer || undefined;
	}

	return state;
}

export function randomAnswer(words: string[]): string {
	return words[Math.floor(Math.random() * words.length)];
}
