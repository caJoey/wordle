import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_BOTS, type BotDifficulty, type LobbySnapshot, type Session } from "../../shared/protocol";
import { evaluateGuess } from "../../shared/wordle";
import { candidatesFor, LobbyManager, type BotGuess, type BotTurn, type Lobby } from "../lobby";
import { FakeScheduler, flush, silentLogger } from "./helpers";

const ANSWER = "crane";
const FAST: [number, number] = [5_000, 5_000];

function setup(opts: { botGuess?: BotGuess; publishDelayMs?: number; } = {}) {
	const clock = new FakeScheduler();
	const updates: Lobby[] = [];
	const last = new Map<string, LobbySnapshot>();
	const m: LobbyManager = new LobbyManager({
		generatePool: async () => [ANSWER],
		botGuess: opts.botGuess,
		publishDelayMs: opts.publishDelayMs,
		scheduler: clock,
		random: () => 0,
		logger: silentLogger,
		timings: { botDelayMs: { easy: FAST, medium: FAST, hard: FAST }, botTimeoutMs: 3_000 },
		hooks: {
			onUpdate: (l) => {
				updates.push(l);
				l.players.forEach((p) => last.set(p.id, m.snapshot(l, p.id)));
			},
		},
	});
	const ok = <T>(r: { ok: true; } & T | { ok: false; error: string; }) => {
		assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
		return r as { ok: true; } & T;
	};
	const host = ok<Session>(m.create("Alice"));
	const lobby = m.get(host.code)!;
	const bots = () => lobby.players.filter((p) => p.bot);
	const addBot = (difficulty?: BotDifficulty) => ok(m.addBot(host.code, host.playerId, difficulty));
	/** Let bots take turns until the round ends or `ms` of game time passes. */
	const runBots = async (ms = 120_000) => {
		for (let t = 0; t < ms && lobby.phase === "PLAYING"; t += 1_000) {
			clock.advance(1_000);
			await flush();
			await flush();
		}
	};
	const toPlaying = async () => {
		ok(m.start(host.code, host.playerId));
		ok(m.submitTheme(host.code, host.playerId, "birds"));
		await flush();
		assert.equal(lobby.phase, "PLAYING");
	};
	return { m, clock, ok, host, lobby, bots, addBot, runBots, toPlaying, updates, last };
}

describe("bots", () => {
	it("only the host adds bots, between rounds, up to MAX_BOTS", () => {
		const t = setup();
		const bob = t.ok<Session>(t.m.join(t.host.code, "Bob"));
		assert.deepEqual(t.m.addBot(t.host.code, bob.playerId), { ok: false, error: "Only the host can add bots" });
		for (let i = 0; i < MAX_BOTS; i++) t.addBot();
		assert.deepEqual(t.m.addBot(t.host.code, t.host.playerId), { ok: false, error: `At most ${MAX_BOTS} bots` });
		assert.deepEqual(t.bots().map((b) => b.name), ["Gemma Bot", "Gemma Bot 2", "Gemma Bot 3", "Gemma Bot 4"]);
		assert.ok(t.bots().every((b) => b.ready && b.connected));
		const views = t.m.snapshot(t.lobby, t.host.playerId).players;
		const bobView = views.find((v) => v.name === "Bob")!, botView = views.find((v) => v.name === "Gemma Bot")!;
		assert.equal(bobView.bot, false);
		assert.equal(bobView.botDifficulty, undefined);
		assert.equal(botView.bot, true);
		assert.equal(botView.botDifficulty, "medium", "default difficulty");
	});

	it("difficulty: set on add, changed by the host only, validated", () => {
		const t = setup();
		t.addBot("easy");
		const bot = t.bots()[0];
		assert.equal(bot.botDifficulty, "easy");
		assert.deepEqual(t.m.addBot(t.host.code, t.host.playerId, "impossible"), { ok: false, error: "Unknown difficulty" });
		const bob = t.ok<Session>(t.m.join(t.host.code, "Bob"));
		assert.equal(t.m.setBotDifficulty(t.host.code, bob.playerId, bot.id, "hard").ok, false);
		assert.equal(t.m.setBotDifficulty(t.host.code, t.host.playerId, bot.id, "nope").ok, false);
		assert.equal(t.m.setBotDifficulty(t.host.code, t.host.playerId, bob.playerId, "hard").ok, false, "humans have no difficulty");
		t.ok(t.m.setBotDifficulty(t.host.code, t.host.playerId, bot.id, "hard"));
		assert.equal(t.m.snapshot(t.lobby, t.host.playerId).players[1].botDifficulty, "hard");
	});

	it("bots never pick the theme", () => {
		const t = setup();
		t.addBot();
		t.ok(t.m.start(t.host.code, t.host.playerId));
		assert.equal(t.lobby.pickerId, t.host.playerId);
	});

	for (const difficulty of ["easy", "medium", "hard"] as const) {
		it(`${difficulty}: without Gemma, plays random candidates that fit what it may know`, async () => {
			const t = setup();
			t.addBot(difficulty);
			await t.toPlaying();
			await t.runBots();
			const bot = t.bots()[0];
			assert.ok(bot.done, "bot finished");
			bot.words.forEach((w, i) => {
				const history = bot.words.slice(0, i).map((word, j) => ({ word, colors: bot.colors[j] }));
				assert.ok(candidatesFor(history, difficulty === "easy" ? "noGrays" : "all").includes(w), `${w} fits the clues`);
				assert.deepEqual(bot.colors[i], evaluateGuess(w, ANSWER));
			});
		});
	}

	for (const difficulty of ["easy", "medium", "hard"] as const) {
		it(`${difficulty}: Gemma gets only what this difficulty allows, never the answer`, async () => {
			const turns: BotTurn[] = [];
			const t = setup({ botGuess: async (turn) => (turns.push(structuredClone(turn)), undefined) });
			t.addBot(difficulty);
			await t.toPlaying();
			await t.runBots(30_000);
			assert.ok(turns.length >= 2);
			for (const turn of turns) {
				assert.deepEqual(Object.keys(turn).sort(), ["history", "theme"], "no answer, no word list");
				assert.equal(turn.theme, difficulty === "hard" ? "birds" : undefined);
				for (const h of turn.history) {
					if (difficulty === "easy") assert.ok(!h.colors.includes("⬛"), "easy forgets grays");
					else assert.ok(!h.colors.includes("🔳"), "full clues");
				}
			}
		});
	}

	it("uses Gemma's pick when it is a real word", async () => {
		const t = setup({ botGuess: async () => "crane" });
		t.addBot("hard");
		await t.toPlaying();
		await t.runBots(10_000);
		assert.deepEqual(t.bots()[0].words, ["crane"]);
		assert.ok(t.bots()[0].solved);
	});

	it("falls back to a fitting word when Gemma fails, times out, returns junk or repeats itself", async () => {
		for (const botGuess of [
			async () => { throw new Error("429"); },
			() => new Promise<string>(() => {}),
			async () => "zzzzz",
		] as BotGuess[]) {
			const t = setup({ botGuess });
			t.addBot();
			await t.toPlaying();
			await t.runBots(10_000);
			assert.ok(t.bots()[0].words.length >= 1);
		}
		// Gemma may break its own clues (a human mistake), but a repeated guess is replaced
		const t = setup({ botGuess: async () => "slate" });
		t.addBot("medium");
		await t.toPlaying();
		await t.runBots(20_000);
		const words = t.bots()[0].words;
		assert.equal(words[0], "slate");
		assert.equal(words.filter((w) => w === "slate").length, 1);
		assert.ok(words.length >= 2);
	});

	it("bots don't hold up the round or the ready check", async () => {
		const t = setup({ botGuess: async () => "crane" });
		t.addBot("hard");
		await t.toPlaying();
		t.ok(t.m.guess(t.host.code, t.host.playerId, "crane"));
		await t.runBots(10_000);
		assert.equal(t.lobby.phase, "RESULTS");
		assert.ok(t.bots()[0].ready);
		t.ok(t.m.ready(t.host.code, t.host.playerId, true));
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.pickerId, t.host.playerId);
	});

	it("removing the last unfinished bot ends the round", async () => {
		const t = setup({ botGuess: () => new Promise(() => {}) });
		t.addBot();
		await t.toPlaying();
		t.ok(t.m.guess(t.host.code, t.host.playerId, "crane"));
		assert.equal(t.lobby.phase, "PLAYING");
		t.ok(t.m.removeBot(t.host.code, t.host.playerId, t.bots()[0].id));
		assert.equal(t.lobby.phase, "RESULTS");
		assert.equal(t.lobby.players.length, 1);
	});

	it("a lobby with only bots left is deleted, leaving no timers", async () => {
		const t = setup();
		t.addBot();
		await t.toPlaying();
		t.m.leave(t.host.code, t.host.playerId);
		assert.equal(t.m.get(t.host.code), undefined);
		assert.equal(t.clock.pending, 0);
	});

	it("batches publishes within publishDelayMs into one broadcast", () => {
		const t = setup({ publishDelayMs: 150 });
		t.m.publish(t.lobby);
		t.addBot();
		t.addBot();
		assert.equal(t.updates.length, 0);
		t.clock.advance(150);
		assert.equal(t.updates.length, 1);
		assert.match(t.last.get(t.host.playerId)!.notice ?? "", /Gemma Bot joined. Gemma Bot 2 joined/);
	});
});

describe("candidatesFor", () => {
	it("noGrays keeps greens and yellows but forgets ruled-out letters", () => {
		const history = [{ word: "trace", colors: evaluateGuess("trace", "crane") }]; // ⬛🟩🟩🟨🟩
		const full = candidatesFor(history);
		const noGrays = candidatesFor(history, "noGrays");
		assert.ok(full.includes("crane") && noGrays.includes("crane"));
		assert.ok(!full.includes("trace") && !noGrays.includes("trace"), "already guessed");
		for (const w of noGrays) assert.ok(w[1] === "r" && w[2] === "a" && w[4] === "e" && w[3] !== "c" && w.includes("c"));
		// "t" was gray: full clues rule out t-words, noGrays doesn't
		assert.ok(full.every((w) => !w.includes("t")));
		assert.ok(noGrays.length >= full.length);
	});
});
