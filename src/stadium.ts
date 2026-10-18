/**
 * Stadium mode: a crowd meter for every player. It runs hot when you're close to the answer and when your
 * race is on the line: neck and neck with a rival, or down to the guess that decides it. Other players'
 * guesses move it by how much they change your race, so a guess from someone you aren't really racing
 * barely registers.
 * Pure logic only, so it can be tested without a browser. Sound lives in crowd.ts, visuals in components/stadium.
 */
import { COLS, ROWS, type LetterState, type PlayerView } from "../shared/protocol";

/** How fast a burst of momentum or pressure fades, and how long tension lingers once a race is settled. */
const HALF_LIFE_MS = 5000;
const MAX_MOMENTUM = 30;
const MIN_MOMENTUM = -25;
/** How much of a rival's big play your crowd feels when it's neck and neck for the win... */
const RIVAL_SHARE = 0.8;
/** ...and their slips take some of the air out. */
const RELIEF_SHARE = 0.7;
/** A solve, as a play the rest of the lobby feels. */
const SOLVE_SWING = 30;
const MAX_PRESSURE = 30;
const MIN_PRESSURE = -15;
/** Stakes this high (a coin flip the next guess will settle) max out the stakes part of the meter. */
const FULL_STAKES = 0.5;
/** Above 1 so long shots barely register while real races are felt in full. */
const STAKES_CURVE = 1.5;
/** A lead change is only called for a real favorite. */
const LEAD_ODDS = 0.4;
const LEAD_MARGIN = 0.2;

// The race model. The chance a guess solves it is a logistic in letters found and guesses used, fitted to
// simulated games (always guessing a word that fits every clue), which finish in about 4 guesses on average.
const SOLVE_BASE = -5.25;
const SOLVE_PER_LETTER = 1.1;
const SOLVE_PER_GUESS = 0.73;
/** Each miss turns up about a quarter of the letters still missing. */
const LETTERS_PER_MISS = 0.25;

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

/** The most letters found in any one guess. Greens and yellows say about as much about how close you are. */
export function lettersFound(colors: LetterState[][]) {
	return Math.max(0, ...colors.map((r) => r.filter((s) => s === "🟩" || s === "🟨").length));
}

/** Chance the next guess solves it, for a player who has found `letters` letters in `used` guesses. */
export function solveChance(letters: number, used: number) {
	return 1 / (1 + Math.exp(-(SOLVE_BASE + SOLVE_PER_LETTER * letters + SOLVE_PER_GUESS * used)));
}

/** Where a player stands in the race. */
export type Outlook = {
	used: number;
	/** chance[k]: the chance of solving on guess k. Whatever's left over is the chance of not solving. */
	chance: number[];
	solved: boolean;
	solveMs?: number;
};

export function outlook(p: PlayerView): Outlook {
	const used = p.colors.length;
	const chance: number[] = Array(ROWS + 1).fill(0);
	if (p.solved) chance[used] = 1;
	else if (!p.done) {
		let letters = lettersFound(p.colors);
		let left = 1;
		for (let k = used + 1; k <= ROWS; ++k) {
			chance[k] = left * solveChance(letters, k - 1);
			left -= chance[k];
			letters += (COLS - letters) * LETTERS_PER_MISS;
		}
	}
	return { used, chance, solved: p.solved, solveMs: p.solveMs };
}

function total(o: Outlook) {
	return o.chance.reduce((a, b) => a + b, 0);
}

/** When both solve in as many guesses, the chance `a` got there first. */
function tieBreak(a: Outlook, b: Outlook) {
	if (a.solved !== b.solved) return a.solved ? 1 : 0;
	if (!a.solved || a.solveMs === b.solveMs) return 0.5;
	return (a.solveMs ?? 0) < (b.solveMs ?? 0) ? 1 : 0;
}

/**
 * Chance `a` finishes ahead of `b`, ranked like the server does: solvers first, then fewer guesses, then
 * sooner. Two players who both miss are a coin flip.
 */
export function beats(a: Outlook, b: Outlook) {
	const tie = tieBreak(a, b);
	// b solves after guess k, or not at all
	let after = 1 - total(b);
	let win = 0.5 * (1 - total(a)) * after;
	for (let k = ROWS; k >= 1; --k) {
		win += a.chance[k] * (after + tie * b.chance[k]);
		after += b.chance[k];
	}
	return win;
}

/** The two ways the next guess can go: the chance it solves it, and the outlook after a hit or a miss. */
function nextGuess(o: Outlook): [number, Outlook, Outlook] | undefined {
	const k = o.used + 1;
	const h = o.chance[k];
	if (o.solved || !h) return;
	const hit: number[] = Array(ROWS + 1).fill(0);
	hit[k] = 1;
	return [
		h,
		// Anyone already solved in as many guesses got there first
		{ used: k, chance: hit, solved: true, solveMs: Infinity },
		{ used: k, chance: o.chance.map((c, i) => (i > k ? c / (1 - h) : 0)), solved: false },
	];
}

/**
 * How much a matchup can swing on the next guess from either side: about 0 when it's settled or nobody's
 * close to solving, highest when it's a coin flip that the next guess will decide.
 */
function matchupStakes(me: Outlook, rival: Outlook) {
	const now = beats(rival, me);
	let squares = 0;
	for (const side of [me, rival]) {
		const next = nextGuess(side);
		if (!next) continue;
		const [h, hit, miss] = next;
		const after = (o: Outlook) => (side === me ? beats(rival, o) : beats(o, me));
		const swing = h * Math.abs(after(hit) - now) + (1 - h) * Math.abs(after(miss) - now);
		squares += swing * swing;
	}
	return Math.sqrt(squares);
}

/** How much the next guess decides whether you solve it at all, which matters most on your last shots. */
function solveStakes(me: Outlook) {
	const next = nextGuess(me);
	if (!next) return 0;
	const [h, , miss] = next;
	const solves = total(me);
	return h * (1 - solves) + (1 - h) * (solves - total(miss));
}

/**
 * What's riding on the next guesses for `me`, 0..1. Each rival counts by how much their matchup with you
 * could decide the round (`weights`, 0..1). The tightest race counts most, a pack of close rivals adds a little.
 */
function raceStakes(me: Outlook, rivals: Outlook[], weights: number[]) {
	let sum = solveStakes(me) ** 4;
	rivals.forEach((r, i) => (sum += (weights[i] * matchupStakes(me, r)) ** 4));
	return Math.min(1, sum ** 0.25 / FULL_STAKES) ** STAKES_CURVE;
}

/** Each player's chance of winning the round: solving it in the fewest guesses, and first on a tie. */
export function winChances(outlooks: Outlook[]) {
	return outlooks.map((me, i) => {
		let win = 0;
		for (let k = 1; k <= ROWS; ++k) {
			let clear = me.chance[k];
			for (let j = 0; j < outlooks.length && clear; ++j) {
				if (j === i) continue;
				const o = outlooks[j];
				let notAhead = 1 - total(o) + tieBreak(me, o) * o.chance[k];
				for (let m = k + 1; m <= ROWS; ++m) notAhead += o.chance[m];
				clear *= notAhead;
			}
			win += clear;
		}
		return win;
	});
}

/**
 * How much a matchup could decide the round, 0..1, from the two players' chances of winning it. Contenders
 * count in full; a battle at the back of a big lobby, or for second once someone's out of reach, barely counts.
 */
function relevance(a: number, b: number) {
	return Math.min(1, 2 * (a + b));
}

/** How open a matchup is, from the chance one finishes ahead: 1 for a coin flip, about 0 when it's a foregone conclusion. */
function openness(ahead: number) {
	return (4 * ahead * (1 - ahead)) ** 2;
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
	/** Felt from rivals' guesses: up when one closes in on you, down a little when one slips. */
	pressure: number;
	pressureAt: number;
	/** Where they stood at the last update, to measure what each new guess changed. */
	outlook?: Outlook;
	/** Chance of winning the round, as of the last update. */
	odds: number;
	/** What their next guesses were worth, as of the last update. */
	stakes: number;
	/** Recent stakes, fading out, so a settled race doesn't go quiet the instant it's decided. */
	tension: number;
	tensionAt: number;
	/** Set when a player has had their roar, so the meter can stay pinned. */
	solved: boolean;
	failed: boolean;
};

type Standings = { players: PlayerView[]; active: PlayerView[]; outlooks: Outlook[]; odds: number[]; stakes: number[]; };

/**
 * Follows the lobby from snapshot to snapshot, remembering what each player has done so it can spot
 * big moments (events) and keep a decaying momentum and pressure per player.
 */
export class StadiumTracker {
	private tracks = new Map<string, Track>();
	private started = false;
	private anySolved = false;
	private leader: string | undefined;
	private memo: Standings | undefined;

	/**
	 * Feed the latest players. Returns the events since the previous update. The first update only
	 * learns the state, so reloading mid-round doesn't replay every guess.
	 */
	update(players: PlayerView[], now: number): StadiumEvent[] {
		const events: StadiumEvent[] = [];
		const silent = !this.started;
		this.started = true;
		const { active, outlooks, odds, stakes } = this.standings(players);
		// What each player's new guesses were worth to the crowd, by index in `active`, for everyone else's meters
		const plays = new Map<number, number>();

		for (const [index, p] of active.entries()) {
			let t = this.tracks.get(p.id);
			if (!t) {
				t = {
					guesses: 0, best: 0, lastGuessAt: now, momentum: 0, momentumAt: now, pressure: 0, pressureAt: now,
					odds: 0, stakes: 0, tension: 0, tensionAt: now, solved: false, failed: false,
				};
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
			// Big plays in big moments: the same guess moves the crowd more when the race is on the line
			const lift = 0.8 + 0.6 * t.stakes;
			let play = 0;
			for (let i = t.guesses; i < n; ++i) {
				const row = p.colors[i];
				const score = rowScore(row);
				const gain = score - t.best;
				const pace = paceFactor(now - t.lastGuessAt);
				const guesses = i + 1;
				t.lastGuessAt = now;
				let swing = 0;
				if (greens(row) === COLS) {
					t.solved = true;
					events.push({ type: "solve", playerId: p.id, guesses, first: !this.anySolved });
					this.anySolved = true;
					play += SOLVE_SWING;
				} else if (gain >= 3 || (greens(row) >= 3 && gain > 0)) {
					swing = gain * 4 * pace;
					events.push({ type: "cook", playerId: p.id, guesses });
				} else if (guesses > 1 && (score <= 1 || score <= t.best - 4)) {
					swing = -15;
					events.push({ type: "gasp", playerId: p.id, guesses });
				} else if (gain > 0) {
					swing = gain * 2 * pace;
				}
				if (swing) this.bump(t, now, swing * lift);
				play += swing;
				t.best = Math.max(t.best, score);
			}
			if (play) plays.set(index, play);
			t.guesses = n;
			if (!t.failed && p.done && !p.solved && n >= ROWS) {
				t.failed = true;
				events.push({ type: "fail", playerId: p.id, guesses: n });
			}
		}

		// Everyone else feels a play by how much that player matters to their race: in full when it's neck
		// and neck for the win, hardly at all from someone way off the pace or already out of it
		for (const [r, play] of plays) {
			const rival = this.tracks.get(active[r].id)!;
			const before = rival.outlook;
			if (!before) continue;
			active.forEach((p, i) => {
				const t = this.tracks.get(p.id)!;
				if (i === r || p.done || !t.outlook) return;
				// Judged both before and after the guess, so a rival catching up counts as much as one pulling away
				const open = Math.max(openness(beats(before, t.outlook)), openness(beats(outlooks[r], t.outlook)));
				const matters = open * Math.max(relevance(t.odds, rival.odds), relevance(odds[i], odds[r]));
				this.press(t, now, matters * play * (play > 0 ? RIVAL_SHARE : RELIEF_SHARE));
			});
		}
		active.forEach((p, i) => {
			const t = this.tracks.get(p.id)!;
			t.tension = Math.max(t.stakes, fade(t.tension, now - t.tensionAt));
			t.tensionAt = now;
			t.outlook = outlooks[i];
			t.odds = odds[i];
			t.stakes = stakes[i];
		});

		// A lead change is only worth calling once someone is a real favorite
		const ranked = active.map((p, i) => ({ p, odds: odds[i] })).sort((a, b) => b.odds - a.odds);
		const [top, second] = ranked;
		if (top && second && top.odds >= LEAD_ODDS && top.odds - second.odds >= LEAD_MARGIN) {
			// Getting the lead back by sitting on a solve while a rival slips isn't news
			if (!silent && this.leader && top.p.id !== this.leader && !top.p.solved && !events.some((e) => e.type === "solve")) {
				events.push({ type: "lead", playerId: top.p.id, guesses: top.p.colors.length });
			}
			this.leader = top.p.id;
		}

		return events.sort((a, b) => EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type]);
	}

	private bump(t: Track, now: number, amount: number) {
		t.momentum = clamp(fade(t.momentum, now - t.momentumAt) + amount, MIN_MOMENTUM, MAX_MOMENTUM);
		t.momentumAt = now;
	}

	private press(t: Track, now: number, amount: number) {
		t.pressure = clamp(fade(t.pressure, now - t.pressureAt) + amount, MIN_PRESSURE, MAX_PRESSURE);
		t.pressureAt = now;
	}

	/** Everyone's place in the race. Worked out once per snapshot, since the meters redraw several times a second. */
	private standings(players: PlayerView[]): Standings {
		if (this.memo?.players !== players) {
			const active = players.filter((p) => !p.spectating);
			const outlooks = active.map(outlook);
			const odds = winChances(outlooks);
			const stakes = outlooks.map((me, i) => {
				const rivals = outlooks.filter((_, j) => j !== i);
				const weights = odds.filter((_, j) => j !== i).map((o) => relevance(odds[i], o));
				return raceStakes(me, rivals, weights);
			});
			this.memo = { players, active, outlooks, odds, stakes };
		}
		return this.memo;
	}

	/** Crowd meter 0..100 for every playing player. */
	hypes(players: PlayerView[], now: number) {
		const { active, stakes } = this.standings(players);
		return active.map((p, i) => {
			if (p.solved) return { id: p.id, hype: 100 };
			const t = this.tracks.get(p.id);
			const swings = t ? fade(t.momentum, now - t.momentumAt) + fade(t.pressure, now - t.pressureAt) : 0;
			const tension = Math.max(stakes[i], t ? fade(t.tension, now - t.tensionAt) : 0);
			// A base hum, then how close you are, what's riding on the next guesses, and the bursts from recent plays
			let hype = 20 + 30 * form(p.colors) + 45 * tension + swings;
			if (p.done) hype = Math.min(hype, 12);
			return { id: p.id, hype: clamp(Math.round(hype), 0, 100) };
		});
	}
}

function fade(amount: number, ms: number) {
	return amount * Math.pow(0.5, ms / HALF_LIFE_MS);
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
