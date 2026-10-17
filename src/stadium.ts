/**
 * Stadium mode: a crowd meter for every player, driven by how well they're doing compared to the rest of the lobby.
 * Pure logic only, so it can be tested without a browser. Sound lives in crowd.ts, visuals in components/stadium.
 */
import { COLS, ROWS, type LetterState, type PlayerView } from "../shared/protocol";

/** How fast a burst of momentum fades. */
const MOMENTUM_HALF_LIFE_MS = 5000;
const MAX_MOMENTUM = 30;
const MIN_MOMENTUM = -25;
/** The form a lone player is measured against, roughly a couple of greens. */
const SOLO_BASELINE = 0.3;

export type StadiumEventType = "solve" | "fail" | "cook" | "gasp" | "lead";

export type StadiumEvent = {
	type: StadiumEventType;
	playerId: string;
	/** Guesses used so far. */
	guesses: number;
	/** First player to solve this round. */
	first?: boolean;
};

/** Lower numbers win when only one event can be shown. */
export const EVENT_PRIORITY: Record<StadiumEventType, number> = { solve: 0, fail: 1, cook: 2, gasp: 3, lead: 4 };

/** Value of a single guess: 2 per green, 1 per yellow, 0..10. */
export function rowScore(row: LetterState[]) {
	let score = 0;
	for (const s of row) score += s === "🟩" ? 2 : s === "🟨" ? 1 : 0;
	return score;
}

export function greens(row: LetterState[]) {
	return row.filter((s) => s === "🟩").length;
}

function isSolved(colors: LetterState[][]) {
	const last = colors[colors.length - 1];
	return !!last && last.length === COLS && last.every((s) => s === "🟩");
}

/** How close a player is to the answer, 0..1. Progress made late in the round counts for a little less. */
export function form(colors: LetterState[][]) {
	if (!colors.length) return 0;
	if (isSolved(colors)) return 1;
	const best = Math.max(...colors.map(rowScore)) / (COLS * 2);
	return best * (1 - 0.05 * (colors.length - 1));
}

/** Momentum bonus multiplier for how quickly a guess followed the previous one. */
export function paceFactor(gapMs: number) {
	if (gapMs < 8000) return 1.5;
	if (gapMs < 20000) return 1;
	return 0.7;
}

export type Level = { min: number; label: string; tier: number; };

export const LEVELS: Level[] = [
	{ min: 0, label: "it's so over", tier: 0 },
	{ min: 20, label: "mid", tier: 1 },
	{ min: 40, label: "warming up", tier: 2 },
	{ min: 60, label: "cooking 🔥", tier: 3 },
	{ min: 80, label: "locked in", tier: 4 },
	{ min: 95, label: "stadium shaking", tier: 5 },
];

export function levelFor(hype: number): Level {
	let level = LEVELS[0];
	for (const l of LEVELS) if (hype >= l.min) level = l;
	return level;
}

type Track = {
	guesses: number;
	best: number;
	lastGuessAt: number;
	momentum: number;
	momentumAt: number;
	/** Set when a player has had their roar, so the meter can stay pinned. */
	solved: boolean;
	failed: boolean;
};

/**
 * Follows the lobby from snapshot to snapshot, remembering what each player has done so it can spot
 * big moments (events) and keep a decaying momentum bonus per player.
 */
export class StadiumTracker {
	private tracks = new Map<string, Track>();
	private started = false;
	private anySolved = false;
	private leader: string | undefined;

	/**
	 * Feed the latest players. Returns the events since the previous update. The first update only
	 * learns the state, so reloading mid-round doesn't replay every guess.
	 */
	update(players: PlayerView[], now: number): StadiumEvent[] {
		const events: StadiumEvent[] = [];
		const silent = !this.started;
		this.started = true;

		for (const p of players) {
			if (p.spectating) continue;
			let t = this.tracks.get(p.id);
			if (!t) {
				t = { guesses: 0, best: 0, lastGuessAt: now, momentum: 0, momentumAt: now, solved: false, failed: false };
				this.tracks.set(p.id, t);
			}
			const n = p.colors.length;
			if (silent) {
				t.guesses = n;
				t.best = n ? Math.max(...p.colors.map(rowScore)) : 0;
				t.solved = p.solved;
				t.failed = p.done && !p.solved;
				this.anySolved ||= p.solved;
				continue;
			}
			for (let i = t.guesses; i < n; ++i) {
				const row = p.colors[i];
				const score = rowScore(row);
				const gain = score - t.best;
				const pace = paceFactor(now - t.lastGuessAt);
				const guesses = i + 1;
				t.lastGuessAt = now;
				if (greens(row) === COLS) {
					t.solved = true;
					events.push({ type: "solve", playerId: p.id, guesses, first: !this.anySolved });
					this.anySolved = true;
				} else if (gain >= 3 || (greens(row) >= 3 && gain > 0)) {
					this.bump(t, now, gain * 4 * pace);
					events.push({ type: "cook", playerId: p.id, guesses });
				} else if (guesses > 1 && (score <= 1 || score <= t.best - 4)) {
					this.bump(t, now, -15);
					events.push({ type: "gasp", playerId: p.id, guesses });
				} else if (gain > 0) {
					this.bump(t, now, gain * 2 * pace);
				}
				t.best = Math.max(t.best, score);
			}
			t.guesses = n;
			if (!t.failed && p.done && !p.solved && n >= ROWS) {
				t.failed = true;
				events.push({ type: "fail", playerId: p.id, guesses: n });
			}
		}

		// A lead change is only worth calling once someone has built a real lead
		const ranked = this.hypes(players, now).sort((a, b) => b.hype - a.hype);
		const top = ranked[0];
		if (top && ranked.length > 1 && top.hype >= 60 && top.hype - ranked[1].hype >= 8) {
			if (!silent && this.leader && top.id !== this.leader && !events.some((e) => e.type === "solve")) {
				events.push({ type: "lead", playerId: top.id, guesses: this.tracks.get(top.id)?.guesses ?? 0 });
			}
			this.leader = top.id;
		}

		return events.sort((a, b) => EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type]);
	}

	private bump(t: Track, now: number, amount: number) {
		t.momentum = clamp(this.momentum(t, now) + amount, MIN_MOMENTUM, MAX_MOMENTUM);
		t.momentumAt = now;
	}

	private momentum(t: Track, now: number) {
		return t.momentum * Math.pow(0.5, (now - t.momentumAt) / MOMENTUM_HALF_LIFE_MS);
	}

	/** Crowd meter 0..100 for every playing player. */
	hypes(players: PlayerView[], now: number) {
		const active = players.filter((p) => !p.spectating);
		const forms = new Map(active.map((p) => [p.id, form(p.colors)]));
		return active.map((p) => {
			const t = this.tracks.get(p.id);
			if (p.solved) return { id: p.id, hype: 100 };
			const mine = forms.get(p.id) ?? 0;
			const others = active.filter((o) => o.id !== p.id).map((o) => forms.get(o.id) ?? 0);
			const field = others.length ? others.reduce((a, b) => a + b, 0) / others.length : SOLO_BASELINE;
			let hype = 35 + 40 * mine + 60 * (mine - field) + (t ? this.momentum(t, now) : 0);
			if (p.done) hype = Math.min(hype, 12);
			return { id: p.id, hype: clamp(Math.round(hype), 0, 100) };
		});
	}
}

function clamp(n: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, n));
}

const LINES: Record<StadiumEventType, { you: string[]; them: string[]; }> = {
	cook: {
		you: ["OH YOU'RE COOKING 🔥", "LET 'EM COOK", "YOU ARE HIM", "locked in. no cap.", "+1000 aura"],
		them: ["OH {n}'S COOKING 🔥", "LET {n} COOK", "{n} IS HIM", "{n} is locked in fr", "{n} said watch this"],
	},
	gasp: {
		you: ["chat is this real 💀", "you fumbled 😭", "bro what was that", "-500 aura", "the crowd is NOT having it"],
		them: ["chat is this real 💀", "{n} fumbled the bag", "{n} is NOT locked in", "{n} that guess was so mid", "-500 aura for {n}"],
	},
	solve: {
		you: ["YOU SOLVED IT. ABSOLUTE CINEMA 🎬", "TOUCHDOWN 🙌 THE STADIUM IS SHAKING", "W. MASSIVE W. 🏆", "RING THE BELL 🔔"],
		them: ["{n} SOLVED IT. ABSOLUTE CINEMA 🎬", "RING THE BELL. {n} IS HIM 🔔", "{n} WALKED IT IN 🏈", "TOUCHDOWN {n} 🙌"],
	},
	fail: {
		you: ["it's so over 😔", "the crowd is heading for the exits", "L. we move."],
		them: ["{n} took the L 😔", "it's so over for {n}", "{n} got benched"],
	},
	lead: {
		you: ["LEAD CHANGE!! YOU TAKE OVER", "you're running the show now 👑"],
		them: ["LEAD CHANGE!! {n} TAKES OVER", "{n} running the show now 👑"],
	},
};

const MIRACLE = ["NO WAY. CHAT IS THIS REAL 🤯", "ACTUAL GOAT BEHAVIOR 🐐", "THAT'S ILLEGAL 🚨"];

/** A commentator line for an event. `pick` chooses from the options, so tests can make it deterministic. */
export function commentary(event: StadiumEvent, name: string, isYou: boolean, pick = Math.random) {
	const options = event.type === "solve" && event.guesses <= 2
		? MIRACLE
		: LINES[event.type][isYou ? "you" : "them"];
	const line = options[Math.floor(pick() * options.length) % options.length];
	return line.replaceAll("{n}", name.toUpperCase());
}
