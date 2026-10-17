import type {
	GameSnapshot,
	PlayerSnapshot,
	RoundDuration,
} from "../../../shared/multiplayer.js";

export interface Player extends PlayerSnapshot {
	socketId: string;
}

export interface Lobby {
	code: string;
	maxPlayers: number;
	players: Player[];
	phase: GameSnapshot["phase"];
	theme: string | null;
	themePickerIndex: number;
	durationMinutes: RoundDuration;
	endsAt: number | null;
	answer: string | null;
	winnerId: string | null;
	timer?: ReturnType<typeof setTimeout>;
}
