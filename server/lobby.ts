import { randomBytes, randomInt } from "node:crypto";
import {
	CODE_LENGTH,
	COLS,
	DEFAULT_ROUND_SECONDS,
	BOT_DIFFICULTIES,
	MAX_BOTS,
	MAX_PLAYERS,
	RECONNECT_GRACE_SECONDS,
	ROWS,
	THEME_MAX_LENGTH,
	THEME_PICK_SECONDS,
	type Ack,
	type BotDifficulty,
	type LetterState,
	type LobbySnapshot,
	type Phase,
	type PlayerView,
	type RankEntry,
	type RoundResults,
	type Session,
} from "../shared/protocol";
import { answerWords, evaluateGuess, isAnswerWord, isValidGuess } from "../shared/wordle";

/**
 * gemma.ts throws `ThemeError` for themes that are too narrow. Matched by name rather than
 * instanceof so this module doesn't have to load the Gemma client (and tests can use a stub class).
 */
export function isThemeError(err: unknown): err is Error {
	return err instanceof Error && (err.name === "ThemeError" || err.constructor?.name === "ThemeError");
}

/** Clock + timers, injectable so tests can drive time by hand. */
export interface Scheduler {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface Timings {
	themePickMs: number;
	graceMs: number;
	generateTimeoutMs: number;
	emptyLobbyMs: number;
	/** A bot waits a random time in its difficulty's [min, max] range before each guess. */
	botDelayMs: Record<BotDifficulty, [number, number]>;
	/** Give up on Gemma for one bot guess after this long and play a random candidate. */
	botTimeoutMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
	themePickMs: THEME_PICK_SECONDS * 1000,
	graceMs: RECONNECT_GRACE_SECONDS * 1000,
	generateTimeoutMs: 20_000,
	emptyLobbyMs: 5 * 60_000,
	botDelayMs: { easy: [12_000, 24_000], medium: [8_000, 16_000], hard: [4_000, 9_000] },
	botTimeoutMs: 10_000,
};

export const MIN_ROUND_SECONDS = 60;
export const MAX_ROUND_SECONDS = 600;
export const NAME_MAX_LENGTH = 16;
export const PRESET_THEMES = ["animals", "food", "sports", "nature", "music"];
export const GENERATOR_UNAVAILABLE = "Theme generator unavailable, using a random word";

export type GeneratePool = (theme: string, exclude?: string[]) => Promise<string[]>;

/** What a bot is told: its own (difficulty-filtered) clues, and the theme on hard. Never a word list. */
export type BotTurn = { theme?: string; history: { word: string; colors: LetterState[]; }[]; };
/** Choose a bot's next guess. Undefined or a rejection means "play a random candidate". */
export type BotGuess = (turn: BotTurn) => Promise<string | undefined>;

export const BOT_NAME = "Gemma Bot";
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "medium";

/** "noGrays" forgets which letters are absent, so the bot keeps retrying ruled-out letters. */
export type CluesUsed = "noGrays" | "all";

/**
 * What a bot may use, by difficulty. Clues matter most; measured with random picks over 400 games:
 * greens + yellows solves 66% (avg 4.4 guesses), all clues 98% (avg 4.0). With Gemma choosing,
 * all clues averaged 3.6, and adding the theme gets hard bots to 2-4 guesses.
 */
export const BOT_SKILL: Record<BotDifficulty, { clues: CluesUsed; theme: boolean; }> = {
	easy: { clues: "noGrays", theme: false },
	medium: { clues: "all", theme: false },
	hard: { clues: "all", theme: true },
};

export function isBotDifficulty(d: unknown): d is BotDifficulty {
	return (BOT_DIFFICULTIES as readonly unknown[]).includes(d);
}

export interface Player {
	id: string;
	token: string;
	name: string;
	/** Join order; lower = present longer. */
	seq: number;
	connected: boolean;
	/** Disconnected for longer than the grace period. */
	graceExpired: boolean;
	graceTimer?: unknown;
	ready: boolean;
	colors: LetterState[][];
	words: string[];
	solved: boolean;
	done: boolean;
	solveMs?: number;
	spectating: boolean;
	wins: number;
	bot: boolean;
	botDifficulty?: BotDifficulty;
	botTimer?: unknown;
}

export interface Lobby {
	code: string;
	phase: Phase;
	roundId: number;
	players: Player[];
	hostId: string;
	pickerId?: string;
	/** seq of the most recent picker; the next picker is the next connected player after it. */
	rotationSeq: number;
	/** Pickers skipped (timeout / left) in the current THEME_PICK. */
	skips: number;
	theme?: string;
	roundSeconds: number;
	endsAt?: number;
	roundStart: number;
	answer?: string;
	results?: RoundResults;
	notice?: string;
	used: Set<string>;
	phaseTimer?: unknown;
	emptyTimer?: unknown;
	genSeq: number;
	nextSeq: number;
	deleted: boolean;
}

export interface LobbyHooks {
	/** Called after every state change; broadcast a snapshot to every player. */
	onUpdate?(lobby: Lobby): void;
	/** A player was removed. `reason` is set when the removal was not voluntary. */
	onRemoved?(lobby: Lobby, playerId: string, reason?: string): void;
	onDeleted?(lobby: Lobby): void;
}

export interface LobbyManagerOptions {
	generatePool: GeneratePool;
	botGuess?: BotGuess;
	scheduler?: Scheduler;
	timings?: Partial<Timings>;
	/** [0, 1) random source for answer / preset picks. */
	random?: () => number;
	hooks?: LobbyHooks;
	logger?: Pick<Console, "error" | "log">;
	/**
	 * Batch snapshots: changes within this window go out as one broadcast. 0 = send immediately.
	 * With 50 players every broadcast is 50 snapshots of 50 boards, so bursts of guesses add up.
	 */
	publishDelayMs?: number;
}

// ---------------------------------------------------------------- ranking

export type RankInput = { id: string; solved: boolean; colors: LetterState[][]; solveMs?: number; };

/** Answer words not yet guessed that fit the clues the bot uses (see CluesUsed). */
export function candidatesFor(history: { word: string; colors: LetterState[]; }[], clues: CluesUsed = "all") {
	const fits = (w: string, h: { word: string; colors: LetterState[]; }) => clues === "all"
		? evaluateGuess(h.word, w).every((c, i) => c === h.colors[i])
		: h.colors.every((c, i) =>
			c === "🟩" ? w[i] === h.word[i] : c === "🟨" ? w[i] !== h.word[i] && w.includes(h.word[i]) : true);
	return answerWords.filter((w) => !history.some((h) => h.word === w) && history.every((h) => fits(w, h)));
}

/** Greens then yellows of the best row. */
export function bestRow(colors: LetterState[][]) {
	let best = { greens: 0, yellows: 0 };
	for (const row of colors) {
		const greens = row.filter((c) => c === "🟩").length;
		const yellows = row.filter((c) => c === "🟨").length;
		if (greens > best.greens || (greens === best.greens && yellows > best.yellows)) best = { greens, yellows };
	}
	return best;
}

/**
 * Solvers first (fewer guesses, then lower solveMs), then non-solvers by greens then yellows of
 * their best row. Exact ties share a place (1, 1, 3).
 */
export function rankPlayers(players: RankInput[]): RankEntry[] {
	const keyed = players.map((p) => ({
		p,
		guesses: p.colors.length,
		ms: p.solveMs ?? Infinity,
		...bestRow(p.colors),
	}));
	type K = (typeof keyed)[number];
	const cmp = (a: K, b: K) => {
		if (a.p.solved !== b.p.solved) return a.p.solved ? -1 : 1;
		if (a.p.solved) return a.guesses - b.guesses || a.ms - b.ms;
		return b.greens - a.greens || b.yellows - a.yellows;
	};
	keyed.sort(cmp);
	const out: RankEntry[] = [];
	keyed.forEach((k, i) => {
		const place = i > 0 && cmp(keyed[i - 1], k) === 0 ? out[i - 1].place : i + 1;
		const entry: RankEntry = { playerId: k.p.id, place, solved: k.p.solved, guesses: k.guesses };
		if (k.p.solved && k.p.solveMs !== undefined) entry.solveMs = k.p.solveMs;
		out.push(entry);
	});
	return out;
}

// ---------------------------------------------------------------- helpers

export function cleanName(raw: unknown) {
	return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH).trim();
}

export function cleanTheme(raw: unknown) {
	return String(raw ?? "").replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, THEME_MAX_LENGTH).trim();
}

export function clampRoundSeconds(n: number) {
	return Math.min(MAX_ROUND_SECONDS, Math.max(MIN_ROUND_SECONDS, Math.round(n)));
}

const fail = (error: string) => ({ ok: false as const, error });

// ---------------------------------------------------------------- manager

export class LobbyManager {
	readonly lobbies = new Map<string, Lobby>();
	hooks: LobbyHooks;
	private readonly generatePool: GeneratePool;
	private readonly botGuess: BotGuess;
	private readonly publishDelayMs: number;
	private readonly publishTimers = new Map<Lobby, unknown>();
	private readonly sched: Scheduler;
	private readonly t: Timings;
	private readonly random: () => number;
	private readonly log: Pick<Console, "error" | "log">;

	constructor(opts: LobbyManagerOptions) {
		this.generatePool = opts.generatePool;
		this.botGuess = opts.botGuess ?? (async () => undefined);
		this.publishDelayMs = opts.publishDelayMs ?? 0;
		this.sched = opts.scheduler ?? realScheduler;
		this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
		this.random = opts.random ?? Math.random;
		this.hooks = opts.hooks ?? {};
		this.log = opts.logger ?? console;
	}

	get(code: string) {
		return this.lobbies.get(code);
	}

	/** Broadcast the current state, then clear the one-off notice. */
	publish(l: Lobby) {
		if (l.deleted) return;
		if (!this.publishDelayMs) return this.flush(l);
		if (this.publishTimers.has(l)) return;
		this.publishTimers.set(l, this.sched.setTimeout(() => this.flush(l), this.publishDelayMs));
	}

	private flush(l: Lobby) {
		this.publishTimers.delete(l);
		if (l.deleted) return;
		this.hooks.onUpdate?.(l);
		l.notice = undefined;
	}

	dispose() {
		for (const l of [...this.lobbies.values()]) this.deleteLobby(l);
	}

	// ------------------------------------------------------------ sessions
	// create / join / rejoin do NOT publish: the caller binds the socket first, then calls publish().

	create(rawName: unknown): Ack<Session> {
		const name = cleanName(rawName);
		if (!name) return fail("Enter a name");
		let code: string;
		do code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
		while (this.lobbies.has(code));
		const l: Lobby = {
			code,
			phase: "LOBBY",
			roundId: 0,
			players: [],
			hostId: "",
			rotationSeq: -1,
			skips: 0,
			roundSeconds: DEFAULT_ROUND_SECONDS,
			roundStart: 0,
			used: new Set(),
			genSeq: 0,
			nextSeq: 0,
			deleted: false,
		};
		const p = this.addPlayer(l, name);
		l.hostId = p.id;
		this.lobbies.set(code, l);
		return { ok: true, code, playerId: p.id, token: p.token };
	}

	join(rawCode: unknown, rawName: unknown): Ack<Session> {
		const l = this.lobbies.get(String(rawCode ?? "").trim());
		if (!l) return fail("Lobby not found");
		if (l.players.length >= MAX_PLAYERS) return fail("Lobby is full");
		const base = cleanName(rawName);
		if (!base) return fail("Enter a name");
		const p = this.addPlayer(l, this.uniqueName(l, base));
		p.spectating = l.phase === "PLAYING" || l.phase === "RESULTS";
		this.addNotice(l, `${p.name} joined`);
		this.onConnected(l);
		return { ok: true, code: l.code, playerId: p.id, token: p.token };
	}

	rejoin(rawCode: unknown, playerId: unknown, token: unknown): Ack<Session> {
		const l = this.lobbies.get(String(rawCode ?? "").trim());
		const p = l?.players.find((x) => x.id === playerId);
		if (!l || !p || typeof token !== "string" || p.token !== token) return fail("Session expired");
		this.clearTimer(p.graceTimer);
		p.graceTimer = undefined;
		p.connected = true;
		p.graceExpired = false;
		this.onConnected(l);
		return { ok: true, code: l.code, playerId: p.id, token: p.token };
	}

	disconnect(code: string, playerId: string) {
		const l = this.lobbies.get(code);
		const p = l?.players.find((x) => x.id === playerId);
		if (!l || !p || !p.connected) return;
		p.connected = false;
		this.clearTimer(p.graceTimer);
		p.graceTimer = this.sched.setTimeout(() => this.graceExpired(l, p), this.t.graceMs);
		if (l.phase === "RESULTS") this.checkAllReady(l);
		this.checkEmpty(l);
		this.publish(l);
	}

	leave(code: string, playerId: string) {
		const l = this.lobbies.get(code);
		const p = l?.players.find((x) => x.id === playerId);
		if (!l || !p) return;
		this.removePlayer(l, p);
		this.publish(l);
	}

	// ------------------------------------------------------------ actions

	settings(code: string, playerId: string, roundSeconds: unknown): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.hostId !== playerId) return fail("Only the host can change settings");
		if (l.phase !== "LOBBY") return fail("Settings can only be changed in the lobby");
		const n = Number(roundSeconds);
		if (!Number.isFinite(n)) return fail("Invalid round length");
		l.roundSeconds = clampRoundSeconds(n);
		this.publish(l);
		return { ok: true };
	}

	start(code: string, playerId: string): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.hostId !== playerId) return fail("Only the host can start the game");
		if (l.phase !== "LOBBY") return fail("The game has already started");
		const host = l.players.find((p) => p.id === l.hostId)!;
		l.rotationSeq = host.seq - 1; // the host picks first
		this.beginRound(l);
		this.publish(l);
		return { ok: true };
	}

	submitTheme(code: string, playerId: string, rawTheme: unknown): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.phase !== "THEME_PICK") return fail("Not picking a theme right now");
		if (l.pickerId !== playerId) return fail("It's not your turn to pick");
		const theme = cleanTheme(rawTheme);
		if (!theme) return fail("Enter a theme");
		this.startGenerating(l, theme);
		this.publish(l);
		return { ok: true };
	}

	guess(code: string, playerId: string, rawWord: unknown): Ack<{ colors: LetterState[]; }> {
		const l = this.lobbies.get(code);
		const p = l?.players.find((x) => x.id === playerId);
		if (!l || !p) return fail("Lobby not found");
		if (l.phase !== "PLAYING" || !l.answer) return fail("The round isn't in progress");
		if (p.spectating) return fail("You're spectating this round");
		if (p.done) return fail("You're out of guesses");
		const word = String(rawWord ?? "").trim().toLowerCase();
		if (word.length !== COLS) return fail("Not enough letters");
		if (!isValidGuess(word)) return fail("Not in word list");
		const colors = evaluateGuess(word, l.answer);
		p.colors.push(colors);
		p.words.push(word);
		if (colors.every((c) => c === "🟩")) {
			p.solved = true;
			p.solveMs = this.sched.now() - l.roundStart;
		}
		if (p.solved || p.colors.length >= ROWS) p.done = true;
		this.checkRoundEnd(l);
		this.publish(l);
		return { ok: true, colors };
	}

	addBot(code: string, playerId: string, difficulty: unknown = DEFAULT_BOT_DIFFICULTY): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.hostId !== playerId) return fail("Only the host can add bots");
		if (l.phase !== "LOBBY" && l.phase !== "RESULTS") return fail("Add bots between rounds");
		if (l.players.length >= MAX_PLAYERS) return fail("Lobby is full");
		if (l.players.filter((p) => p.bot).length >= MAX_BOTS) return fail(`At most ${MAX_BOTS} bots`);
		if (!isBotDifficulty(difficulty)) return fail("Unknown difficulty");
		const bot = this.addPlayer(l, this.uniqueName(l, BOT_NAME));
		bot.bot = true;
		bot.botDifficulty = difficulty;
		bot.ready = true;
		bot.spectating = l.phase === "RESULTS";
		this.addNotice(l, `${bot.name} joined`);
		this.publish(l);
		return { ok: true };
	}

	removeBot(code: string, playerId: string, botId: unknown): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.hostId !== playerId) return fail("Only the host can remove bots");
		const bot = l.players.find((p) => p.id === botId && p.bot);
		if (!bot) return fail("Bot not found");
		this.removePlayer(l, bot);
		this.publish(l);
		return { ok: true };
	}

	setBotDifficulty(code: string, playerId: string, botId: unknown, difficulty: unknown): Ack {
		const l = this.lobbies.get(code);
		if (!l) return fail("Lobby not found");
		if (l.hostId !== playerId) return fail("Only the host can change bots");
		const bot = l.players.find((p) => p.id === botId && p.bot);
		if (!bot) return fail("Bot not found");
		if (!isBotDifficulty(difficulty)) return fail("Unknown difficulty");
		bot.botDifficulty = difficulty;
		this.publish(l);
		return { ok: true };
	}

	ready(code: string, playerId: string, ready: unknown): Ack {
		const l = this.lobbies.get(code);
		const p = l?.players.find((x) => x.id === playerId);
		if (!l || !p) return fail("Lobby not found");
		if (l.phase !== "LOBBY" && l.phase !== "RESULTS") return fail("Can't ready up right now");
		p.ready = Boolean(ready);
		this.checkAllReady(l);
		this.publish(l);
		return { ok: true };
	}

	// ------------------------------------------------------------ snapshot

	snapshot(l: Lobby, youId: string): LobbySnapshot {
		const results = l.phase === "RESULTS";
		const players = l.players.map((p) => {
			const v: PlayerView = {
				id: p.id,
				name: p.name,
				connected: p.connected,
				isHost: p.id === l.hostId,
				ready: p.ready,
				colors: p.colors.map((r) => [...r]),
				solved: p.solved,
				done: p.done,
				spectating: p.spectating,
				wins: p.wins,
				bot: p.bot,
			};
			if (p.bot) v.botDifficulty = p.botDifficulty ?? DEFAULT_BOT_DIFFICULTY;
			if (results || (l.phase === "PLAYING" && p.id === youId)) v.words = [...p.words];
			if (p.solveMs !== undefined) v.solveMs = p.solveMs;
			return v;
		});
		const s: LobbySnapshot = {
			code: l.code,
			phase: l.phase,
			roundId: l.roundId,
			players,
			youId,
			roundSeconds: l.roundSeconds,
			serverNow: this.sched.now(),
		};
		if (l.pickerId && (l.phase === "THEME_PICK" || l.phase === "GENERATING" || l.phase === "PLAYING")) s.pickerId = l.pickerId;
		if (l.theme && (l.phase === "GENERATING" || l.phase === "PLAYING" || results)) s.theme = l.theme;
		if (l.endsAt !== undefined) s.endsAt = l.endsAt;
		if (results && l.results) s.results = { ...l.results, ranking: l.results.ranking.map((r) => ({ ...r })) };
		if (l.notice) s.notice = l.notice;
		return s;
	}

	// ------------------------------------------------------------ internals

	private addPlayer(l: Lobby, name: string): Player {
		const p: Player = {
			id: randomBytes(9).toString("base64url"),
			token: randomBytes(24).toString("base64url"),
			name,
			seq: l.nextSeq++,
			connected: true,
			graceExpired: false,
			ready: false,
			colors: [],
			words: [],
			solved: false,
			done: false,
			spectating: false,
			wins: 0,
			bot: false,
		};
		l.players.push(p);
		return p;
	}

	private uniqueName(l: Lobby, base: string) {
		const taken = new Set(l.players.map((p) => p.name.toLowerCase()));
		if (!taken.has(base.toLowerCase())) return base;
		for (let i = 2; ; i++) {
			const suffix = ` ${i}`;
			const name = base.slice(0, NAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
			if (!taken.has(name.toLowerCase())) return name;
		}
	}

	private addNotice(l: Lobby, msg: string) {
		l.notice = l.notice ? `${l.notice}. ${msg}` : msg;
	}

	private clearTimer(h: unknown) {
		if (h !== undefined) this.sched.clearTimeout(h);
	}

	private schedulePhase(l: Lobby, ms: number, fn: () => void) {
		this.clearTimer(l.phaseTimer);
		l.phaseTimer = this.sched.setTimeout(() => {
			l.phaseTimer = undefined;
			if (!l.deleted) fn();
		}, ms);
	}

	private setPhase(l: Lobby, phase: Phase) {
		this.clearBotTimers(l);
		this.clearTimer(l.phaseTimer);
		l.phaseTimer = undefined;
		l.phase = phase;
		l.endsAt = undefined;
	}

	private onConnected(l: Lobby) {
		this.clearTimer(l.emptyTimer);
		l.emptyTimer = undefined;
	}

	/** Bots don't keep a lobby alive: it empties when its last connected human goes. */
	private checkEmpty(l: Lobby) {
		if (l.deleted) return;
		if (!l.players.some((p) => !p.bot)) return this.deleteLobby(l);
		const humansOnline = () => l.players.some((p) => p.connected && !p.bot);
		if (humansOnline() || l.emptyTimer !== undefined) return;
		l.emptyTimer = this.sched.setTimeout(() => {
			l.emptyTimer = undefined;
			if (!humansOnline()) this.deleteLobby(l);
		}, this.t.emptyLobbyMs);
	}

	private deleteLobby(l: Lobby) {
		if (l.deleted) return;
		l.deleted = true;
		this.clearTimer(l.phaseTimer);
		this.clearTimer(l.emptyTimer);
		this.clearTimer(this.publishTimers.get(l));
		this.publishTimers.delete(l);
		l.phaseTimer = l.emptyTimer = undefined;
		this.clearBotTimers(l);
		for (const p of l.players) {
			this.clearTimer(p.graceTimer);
			p.graceTimer = undefined;
		}
		l.genSeq++;
		this.lobbies.delete(l.code);
		this.hooks.onDeleted?.(l);
	}

	private graceExpired(l: Lobby, p: Player) {
		p.graceTimer = undefined;
		if (l.deleted || p.connected || !l.players.includes(p)) return;
		p.graceExpired = true;
		if (l.phase === "PLAYING" && !p.spectating) {
			p.done = true;
			this.checkRoundEnd(l);
		} else {
			this.removePlayer(l, p, "Disconnected for too long");
		}
		this.publish(l);
	}

	/** Remove without phase side effects. Returns false if the lobby was deleted as a result. */
	private dropPlayer(l: Lobby, p: Player, reason?: string) {
		const i = l.players.indexOf(p);
		if (i < 0) return !l.deleted;
		this.clearTimer(p.graceTimer);
		this.clearTimer(p.botTimer);
		p.graceTimer = p.botTimer = undefined;
		l.players.splice(i, 1);
		this.hooks.onRemoved?.(l, p.id, reason);
		if (!l.players.some((x) => !x.bot)) {
			this.deleteLobby(l);
			return false;
		}
		this.addNotice(l, `${p.name} left`);
		if (l.hostId === p.id) {
			const humans = l.players.filter((x) => !x.bot);
			const next = humans.find((x) => x.connected) ?? humans[0];
			l.hostId = next.id;
			this.addNotice(l, `${next.name} is now the host`);
		}
		return true;
	}

	private removePlayer(l: Lobby, p: Player, reason?: string) {
		if (!l.players.includes(p) || !this.dropPlayer(l, p, reason)) return;
		switch (l.phase) {
			case "THEME_PICK":
				if (l.pickerId === p.id) this.skipPicker(l);
				break;
			case "PLAYING":
				this.checkRoundEnd(l);
				break;
			case "RESULTS":
				if (l.results) l.results.ranking = l.results.ranking.filter((r) => r.playerId !== p.id);
				this.checkAllReady(l);
				break;
		}
		this.checkEmpty(l);
	}

	/** RESULTS/LOBBY -> THEME_PICK for the next picker. */
	private beginRound(l: Lobby) {
		for (const p of [...l.players]) {
			if (!p.connected && p.graceExpired && !this.dropPlayer(l, p, "Disconnected for too long")) return;
		}
		l.roundId++;
		l.theme = l.answer = l.results = undefined;
		l.skips = 0;
		for (const p of l.players) {
			p.colors = [];
			p.words = [];
			p.solved = p.done = p.spectating = false;
			p.ready = p.bot;
			p.solveMs = undefined;
		}
		this.enterThemePick(l, this.nextPicker(l));
	}

	private nextPicker(l: Lobby) {
		const eligible = l.players.filter((p) => p.connected && !p.bot);
		return eligible.find((p) => p.seq > l.rotationSeq) ?? eligible[0];
	}

	private enterThemePick(l: Lobby, picker: Player | undefined) {
		if (!picker) return this.usePreset(l);
		this.setPhase(l, "THEME_PICK");
		l.theme = undefined;
		l.pickerId = picker.id;
		l.rotationSeq = picker.seq;
		l.endsAt = this.sched.now() + this.t.themePickMs;
		this.schedulePhase(l, this.t.themePickMs, () => {
			this.addNotice(l, `${picker.name} ran out of time`);
			this.skipPicker(l);
			this.publish(l);
		});
	}

	private skipPicker(l: Lobby) {
		l.skips++;
		const eligible = l.players.filter((p) => p.connected && !p.bot).length;
		const next = this.nextPicker(l);
		if (!next || l.skips >= Math.max(1, eligible)) return this.usePreset(l);
		this.addNotice(l, `${next.name} picks the theme`);
		this.enterThemePick(l, next);
	}

	private usePreset(l: Lobby) {
		const theme = PRESET_THEMES[Math.floor(this.random() * PRESET_THEMES.length)];
		l.pickerId = undefined;
		this.addNotice(l, `No theme picked, using "${theme}"`);
		this.startGenerating(l, theme);
	}

	private startGenerating(l: Lobby, theme: string) {
		this.setPhase(l, "GENERATING");
		l.theme = theme;
		const seq = ++l.genSeq;
		const roundId = l.roundId;
		const stale = () => l.deleted || l.genSeq !== seq || l.roundId !== roundId || l.phase !== "GENERATING";
		this.schedulePhase(l, this.t.generateTimeoutMs, () => {
			if (stale()) return;
			l.genSeq++;
			this.log.error(`[lobby ${l.code}] theme generation timed out for "${theme}"`);
			this.fallback(l);
			this.publish(l);
		});
		const exclude = [...l.used];
		Promise.resolve()
			.then(() => this.generatePool(theme, exclude))
			.then(
				(pool) => {
					if (stale()) return;
					const valid = [...new Set((Array.isArray(pool) ? pool : []).map((w) => String(w).toLowerCase()))].filter(isAnswerWord);
					const fresh = valid.filter((w) => !l.used.has(w));
					if (!fresh.length) {
						this.retryTheme(l, valid.length
							? `Every word for "${theme}" has been used. Pick another theme`
							: `Couldn't find enough words for "${theme}". Try a broader theme.`);
					} else {
						this.startPlaying(l, fresh[Math.floor(this.random() * fresh.length)]);
					}
					this.publish(l);
				},
				(err: unknown) => {
					if (stale()) return;
					if (isThemeError(err)) {
						this.retryTheme(l, err.message);
					} else if (err instanceof Error && err.name === "RateLimitError") {
						// The free Gemma tier allows ~5 generations a minute across all lobbies
						const wait = (err as Error & { retryAfterSeconds?: number }).retryAfterSeconds;
						this.retryTheme(l, `The word generator is busy. Try again${wait ? ` in ${Math.ceil(wait)} s` : " shortly"}`);
					} else {
						this.log.error(`[lobby ${l.code}] theme generation failed:`, err instanceof Error ? err.message : err);
						this.fallback(l);
					}
					this.publish(l);
				},
			);
	}

	/** Back to THEME_PICK for the same picker, or a random word if they're gone. */
	private retryTheme(l: Lobby, notice: string) {
		const picker = l.players.find((p) => p.id === l.pickerId && p.connected);
		if (!picker) return this.fallback(l);
		this.addNotice(l, notice);
		this.enterThemePick(l, picker);
	}

	private fallback(l: Lobby) {
		const unused = answerWords.filter((w) => !l.used.has(w));
		const pool = unused.length ? unused : answerWords;
		this.addNotice(l, GENERATOR_UNAVAILABLE);
		this.startPlaying(l, pool[Math.floor(this.random() * pool.length)]);
	}

	private startPlaying(l: Lobby, answer: string) {
		this.setPhase(l, "PLAYING");
		l.answer = answer;
		l.used.add(answer);
		const now = this.sched.now();
		l.roundStart = now;
		l.endsAt = now + l.roundSeconds * 1000;
		for (const p of l.players) if (!p.spectating && p.graceExpired) p.done = true;
		this.schedulePhase(l, l.roundSeconds * 1000, () => {
			this.endRound(l);
			this.publish(l);
		});
		for (const p of l.players) if (p.bot && !p.spectating) this.scheduleBot(l, p);
		this.checkRoundEnd(l);
	}

	// ------------------------------------------------------------ bots

	private clearBotTimers(l: Lobby) {
		for (const p of l.players) {
			this.clearTimer(p.botTimer);
			p.botTimer = undefined;
		}
	}

	private scheduleBot(l: Lobby, bot: Player) {
		const [botMinMs, botMaxMs] = this.t.botDelayMs[bot.botDifficulty ?? DEFAULT_BOT_DIFFICULTY];
		this.clearTimer(bot.botTimer);
		bot.botTimer = this.sched.setTimeout(() => {
			bot.botTimer = undefined;
			void this.botTurn(l, bot);
		}, botMinMs + this.random() * (botMaxMs - botMinMs));
	}

	/**
	 * One bot guess. Gemma only sees the bot's own clues, cut down by difficulty (BOT_SKILL), plus the
	 * theme on hard, and has to come up with a word itself. Any real word it hasn't played is accepted,
	 * even one that breaks its clues. Only if Gemma fails do we play a random word that fits them.
	 */
	private async botTurn(l: Lobby, bot: Player) {
		const roundId = l.roundId;
		const stale = () => l.deleted || l.roundId !== roundId || l.phase !== "PLAYING" || !l.players.includes(bot) || bot.done;
		if (stale()) return;
		const skill = BOT_SKILL[bot.botDifficulty ?? DEFAULT_BOT_DIFFICULTY];
		const history = bot.words.map((word, i) => ({
			word,
			colors: skill.clues === "all" ? bot.colors[i] : bot.colors[i].map((c): LetterState => (c === "⬛" ? "🔳" : c)),
		}));
		let word: string | undefined;
		let timer: unknown;
		try {
			word = await Promise.race([
				Promise.resolve().then(() => this.botGuess({ theme: skill.theme ? l.theme : undefined, history })),
				new Promise<undefined>((resolve) => (timer = this.sched.setTimeout(() => resolve(undefined), this.t.botTimeoutMs))),
			]);
		} catch (err) {
			this.log.error(`[lobby ${l.code}] ${bot.name} guess failed:`, err instanceof Error ? err.message : err);
		}
		this.clearTimer(timer);
		if (stale()) return;
		if (!word || !isValidGuess(word) || bot.words.includes(word)) {
			const candidates = candidatesFor(history, skill.clues);
			word = candidates.length ? candidates[Math.floor(this.random() * candidates.length)] : undefined;
		}
		if (!word) return;
		this.guess(l.code, bot.id, word);
		if (!stale()) this.scheduleBot(l, bot);
	}

	/**
	 * The round ends when every non-spectating player is done. A player who is disconnected but
	 * still inside the grace period is not done yet, so a page refresh doesn't end the round.
	 */
	private checkRoundEnd(l: Lobby) {
		if (l.phase === "PLAYING" && l.players.filter((p) => !p.spectating).every((p) => p.done)) this.endRound(l);
	}

	private endRound(l: Lobby) {
		this.setPhase(l, "RESULTS");
		const playing = l.players.filter((p) => !p.spectating);
		for (const p of l.players) {
			p.ready = p.bot;
			if (!p.spectating) p.done = true;
		}
		const ranking = rankPlayers(playing);
		for (const r of ranking) {
			if (r.place === 1 && r.solved) l.players.find((p) => p.id === r.playerId)!.wins++;
		}
		l.results = { answer: l.answer!, theme: l.theme ?? "", ranking };
	}

	private checkAllReady(l: Lobby) {
		if (l.phase !== "RESULTS") return;
		// Bots are always ready, so only humans hold up the next round
		let eligible = l.players.filter((p) => p.connected && !p.spectating && !p.bot);
		if (!eligible.length) eligible = l.players.filter((p) => p.connected && !p.bot);
		if (eligible.length && eligible.every((p) => p.ready)) this.beginRound(l);
	}
}
