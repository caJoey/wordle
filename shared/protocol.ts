/**
 * The contract between the multiplayer server and client. Both sides import this file.
 * Change it only by agreement: every field here is read by the other side.
 */

export type LetterState = "🔳" | "⬛" | "🟨" | "🟩";

export type Phase = "LOBBY" | "THEME_PICK" | "GENERATING" | "PLAYING" | "RESULTS";

export const ROWS = 6;
export const COLS = 5;
export const MAX_PLAYERS = 50;
/** Each bot guess is a Gemma call, and the quota is shared by every lobby on the server. */
export const MAX_BOTS = 4;

export const BOT_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];
export const CODE_LENGTH = 6;
export const THEME_MAX_LENGTH = 40;
export const THEME_PICK_SECONDS = 30;
export const DEFAULT_ROUND_SECONDS = 180;
export const RECONNECT_GRACE_SECONDS = 30;

export type PlayerView = {
	id: string;
	name: string;
	connected: boolean;
	isHost: boolean;
	/** Ready for the next round (LOBBY / RESULTS only). */
	ready: boolean;
	/** One entry per submitted guess. Opponents' colors are visible during PLAYING. */
	colors: LetterState[][];
	/**
	 * Guessed words, aligned with `colors`. Only present for the receiving player during PLAYING,
	 * and for everyone during RESULTS. Never sent for opponents while PLAYING.
	 */
	words?: string[];
	solved: boolean;
	/** Solved, out of guesses, or disconnected past the grace period. */
	done: boolean;
	/** Milliseconds from round start to the solving guess, measured on the server. */
	solveMs?: number;
	/** Joined during a round; plays from the next round. */
	spectating: boolean;
	/** Total round wins in this lobby. */
	wins: number;
	/** A Gemma-powered bot. Bots never pick themes and are always ready. */
	bot: boolean;
	/** Only set for bots. */
	botDifficulty?: BotDifficulty;
};

export type RankEntry = {
	playerId: string;
	/** 1 = winner. Exact ties share a place. */
	place: number;
	solved: boolean;
	guesses: number;
	solveMs?: number;
};

export type RoundResults = {
	answer: string;
	theme: string;
	ranking: RankEntry[];
};

export type LobbySnapshot = {
	code: string;
	phase: Phase;
	/** Increments every round. */
	roundId: number;
	players: PlayerView[];
	/** The id of the player receiving this snapshot. */
	youId: string;
	/** Who chooses the theme this round (THEME_PICK / GENERATING / PLAYING). */
	pickerId?: string;
	/** Visible to everyone once chosen. */
	theme?: string;
	roundSeconds: number;
	/** Epoch ms when the current timed phase ends (THEME_PICK or PLAYING). */
	endsAt?: number;
	/** Server clock when this snapshot was built, for clock-offset correction. */
	serverNow: number;
	/** Only in RESULTS. */
	results?: RoundResults;
	/** A one-off message for everyone, e.g. "Theme too narrow, pick another" or "Alice left". */
	notice?: string;
};

export type Ack<T = {}> = ({ ok: true; } & T) | { ok: false; error: string; };

export type Session = { code: string; playerId: string; token: string; };

export interface ClientToServerEvents {
	"lobby:create": (data: { name: string; }, ack: (res: Ack<Session>) => void) => void;
	/** With playerId + token from a previous Session this is a reconnect. */
	"lobby:join": (data: { code: string; name: string; playerId?: string; token?: string; }, ack: (res: Ack<Session>) => void) => void;
	"lobby:leave": () => void;
	/** Host only, LOBBY phase only. */
	"lobby:settings": (data: { roundSeconds: number; }, ack: (res: Ack) => void) => void;
	/** Host only, LOBBY phase only. Moves to THEME_PICK. */
	"game:start": (ack: (res: Ack) => void) => void;
	/** Current picker only, THEME_PICK phase only. */
	"theme:submit": (data: { theme: string; }, ack: (res: Ack) => void) => void;
	/** PLAYING phase only. Error text is shown to the player, e.g. "Not in word list". */
	"guess:submit": (data: { word: string; }, ack: (res: Ack<{ colors: LetterState[]; }>) => void) => void;
	/** Host only, LOBBY or RESULTS phase. Bots added during RESULTS play from the next round. */
	"bot:add": (data: { difficulty: BotDifficulty; }, ack: (res: Ack) => void) => void;
	/** Host only, any phase. */
	"bot:remove": (data: { playerId: string; }, ack: (res: Ack) => void) => void;
	/** Host only, any phase; applies from the bot's next guess. */
	"bot:difficulty": (data: { playerId: string; difficulty: BotDifficulty; }, ack: (res: Ack) => void) => void;
	/** RESULTS phase. When every connected, non-spectating human is ready the next round starts. */
	"player:ready": (data: { ready: boolean; }, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
	/** Sent to each player after every change, redacted for that player. */
	"lobby:snapshot": (snapshot: LobbySnapshot) => void;
	/** Sent when the lobby no longer exists or the player was removed. */
	"lobby:closed": (data: { reason: string; }) => void;
}
