export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
export const ROUND_DURATIONS = [5, 10, null] as const;

export type RoundDuration = (typeof ROUND_DURATIONS)[number];
export type PlayerStatus = "waiting" | "playing" | "solved" | "unsolved";
export type GamePhase = "lobby" | "playing" | "results";

export interface PlayerSnapshot {
	id: string;
	name: string;
	isHost: boolean;
	ready: boolean;
	status: PlayerStatus;
	guesses: string[];
	guessResults: string[][];
	solvedAt?: number;
}

export interface GameSnapshot {
	code: string;
	maxPlayers: number;
	phase: GamePhase;
	players: PlayerSnapshot[];
	theme: string | null;
	themePickerId: string | null;
	durationMinutes: RoundDuration;
	endsAt: number | null;
	winnerId: string | null;
	answer?: string;
}

export interface ClientToServerEvents {
	"lobby:create": (payload: { name: string; maxPlayers: number }, ack: Ack<{ code: string }>) => void;
	"lobby:join": (payload: { code: string; name: string }, ack: Ack) => void;
	"lobby:leave": () => void;
	"theme:set": (payload: { theme: string }, ack: Ack) => void;
	"round:start": (payload: { durationMinutes: RoundDuration }, ack: Ack) => void;
	"guess:submit": (payload: { guess: string }, ack: Ack) => void;
	"player:ready": (payload: { ready: boolean }) => void;
}

export interface ServerToClientEvents {
	"game:state": (state: GameSnapshot) => void;
	"game:error": (message: string) => void;
}

export type Ack<T = Record<string, never>> = (result: ({ ok: true } & T) | { ok: false; error: string }) => void;
