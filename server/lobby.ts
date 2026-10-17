import { randomBytes, randomInt } from "node:crypto";
import {
	CODE_LENGTH,
	COLS,
	DEFAULT_ROUND_SECONDS,
	MAX_PLAYERS,
	RECONNECT_GRACE_SECONDS,
	ROWS,
	THEME_MAX_LENGTH,
	THEME_PICK_SECONDS,
	type Ack,
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
}

export const DEFAULT_TIMINGS: Timings = {
	themePickMs: THEME_PICK_SECONDS * 1000,
	graceMs: RECONNECT_GRACE_SECONDS * 1000,
	generateTimeoutMs: 20_000,
	emptyLobbyMs: 5 * 60_000,
};

export const MIN_ROUND_SECONDS = 60;
export const MAX_ROUND_SECONDS = 600;
export const NAME_MAX_LENGTH = 16;
export const PRESET_THEMES = ["animals", "food", "sports", "nature", "music"];
export const GENERATOR_UNAVAILABLE = "Theme generator unavailable, using a random word";

export type GeneratePool = (theme: string, exclude?: string[]) => Promise<string[]>;

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
	scheduler?: Scheduler;
	timings?: Partial<Timings>;
	/** [0, 1) random source for answer / preset picks. */
	random?: () => number;
	hooks?: LobbyHooks;
	logger?: Pick<Console, "error" | "log">;
}

// ---------------------------------------------------------------- ranking

export type RankInput = { id: string; solved: boolean; colors: LetterState[][]; solveMs?: number; };

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
	private readonly sched: Scheduler;
	private readonly t: Timings;
	private readonly random: () => number;
	private readonly log: Pick<Console, "error" | "log">;

	constructor(opts: LobbyManagerOptions) {
		this.generatePool = opts.generatePool;
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
			};
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
		this.clearTimer(l.phaseTimer);
		l.phaseTimer = undefined;
		l.phase = phase;
		l.endsAt = undefined;
	}

	private onConnected(l: Lobby) {
		this.clearTimer(l.emptyTimer);
		l.emptyTimer = undefined;
	}

	private checkEmpty(l: Lobby) {
		if (l.deleted) return;
		if (l.players.length === 0) return this.deleteLobby(l);
		if (l.players.some((p) => p.connected) || l.emptyTimer !== undefined) return;
		l.emptyTimer = this.sched.setTimeout(() => {
			l.emptyTimer = undefined;
			if (!l.players.some((p) => p.connected)) this.deleteLobby(l);
		}, this.t.emptyLobbyMs);
	}

	private deleteLobby(l: Lobby) {
		if (l.deleted) return;
		l.deleted = true;
		this.clearTimer(l.phaseTimer);
		this.clearTimer(l.emptyTimer);
		l.phaseTimer = l.emptyTimer = undefined;
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
		p.graceTimer = undefined;
		l.players.splice(i, 1);
		this.hooks.onRemoved?.(l, p.id, reason);
		if (l.players.length === 0) {
			this.deleteLobby(l);
			return false;
		}
		this.addNotice(l, `${p.name} left`);
		if (l.hostId === p.id) {
			const next = l.players.find((x) => x.connected) ?? l.players[0];
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
			p.solved = p.done = p.ready = p.spectating = false;
			p.solveMs = undefined;
		}
		this.enterThemePick(l, this.nextPicker(l));
	}

	private nextPicker(l: Lobby) {
		const eligible = l.players.filter((p) => p.connected);
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
		const eligible = l.players.filter((p) => p.connected).length;
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
		this.checkRoundEnd(l);
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
			p.ready = false;
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
		let eligible = l.players.filter((p) => p.connected && !p.spectating);
		if (!eligible.length) eligible = l.players.filter((p) => p.connected);
		if (eligible.length && eligible.every((p) => p.ready)) this.beginRound(l);
	}
}
