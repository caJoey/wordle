import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LetterState, LobbySnapshot, Session } from "../../shared/protocol";
import {
	GENERATOR_UNAVAILABLE,
	LobbyManager,
	PRESET_THEMES,
	rankPlayers,
	type GeneratePool,
} from "../lobby";
import { ThemeError } from "./helpers";
import { FakeScheduler, flush, silentLogger } from "./helpers";

const G = "🟩", Y = "🟨", B = "⬛";
const row = (s: string) => [...s].map((c) => (c === "g" ? G : c === "y" ? Y : B)) as LetterState[];

function setup(pool: GeneratePool = async () => ["crane"]) {
	const clock = new FakeScheduler();
	const state = { pool };
	/** Last snapshot each player received. */
	const last = new Map<string, LobbySnapshot>();
	const removed: { playerId: string; reason?: string; }[] = [];
	const m: LobbyManager = new LobbyManager({
		generatePool: (t, e) => state.pool(t, e),
		scheduler: clock,
		random: () => 0,
		logger: silentLogger,
		timings: { themePickMs: 30_000, graceMs: 30_000, generateTimeoutMs: 20_000, emptyLobbyMs: 300_000 },
		hooks: {
			onUpdate: (l) => l.players.forEach((p) => last.set(p.id, m.snapshot(l, p.id))),
			onRemoved: (_l, playerId, reason) => removed.push({ playerId, reason }),
		},
	});
	const ok = <T>(r: { ok: true; } & T | { ok: false; error: string; }) => {
		assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
		return r as { ok: true; } & T;
	};
	const create = (name = "Alice") => {
		const s = ok<Session>(m.create(name));
		const lobby = m.get(s.code)!;
		m.publish(lobby);
		return { s, lobby };
	};
	const join = (code: string, name: string) => {
		const s = ok<Session>(m.join(code, name));
		m.publish(m.get(code)!);
		return s;
	};
	return { m, clock, state, last, removed, ok, create, join };
}

/** Create a lobby with n players and start it; returns sessions in join order. */
function started(n: number, pool?: GeneratePool) {
	const t = setup(pool);
	const { s: host, lobby } = t.create("Alice");
	const players = [host];
	for (const name of ["Bob", "Cara", "Dan"].slice(0, n - 1)) players.push(t.join(host.code, name));
	t.ok(t.m.start(host.code, host.playerId));
	return { ...t, lobby, players, code: host.code };
}

async function toPlaying(t: ReturnType<typeof started>, pickerIdx = 0, theme = "birds") {
	t.ok(t.m.submitTheme(t.code, t.players[pickerIdx].playerId, theme));
	await flush();
	assert.equal(t.lobby.phase, "PLAYING");
}

describe("rankPlayers", () => {
	it("orders solvers by guesses then solveMs, then unsolved by greens/yellows; ties share", () => {
		const solved3 = [row("bbbbb"), row("ybbbb"), row("ggggg")];
		const r = rankPlayers([
			{ id: "slow3", solved: true, colors: solved3, solveMs: 9000 },
			{ id: "unsolvedG2", solved: false, colors: [row("ggbbb"), row("yyyyy")] },
			{ id: "fast3", solved: true, colors: solved3, solveMs: 5000 },
			{ id: "two", solved: true, colors: [row("bbbbb"), row("ggggg")], solveMs: 20000 },
			{ id: "unsolvedG2Y1", solved: false, colors: [row("ggybb")] },
			{ id: "unsolvedG2b", solved: false, colors: [row("bbbgg")] },
			{ id: "nothing", solved: false, colors: [] },
		]);
		assert.deepEqual(r.map((e) => [e.playerId, e.place]), [
			["two", 1], ["fast3", 2], ["slow3", 3], ["unsolvedG2Y1", 4], ["unsolvedG2", 5], ["unsolvedG2b", 5], ["nothing", 7],
		]);
		assert.equal(r[0].guesses, 2);
		assert.equal(r[0].solveMs, 20000);
		assert.equal(r[3].solveMs, undefined);
	});

	it("exact solver ties share first place", () => {
		const c = [row("ggggg")];
		const r = rankPlayers([{ id: "a", solved: true, colors: c, solveMs: 10 }, { id: "b", solved: true, colors: c, solveMs: 10 }]);
		assert.deepEqual(r.map((e) => e.place), [1, 1]);
	});
});

describe("LobbyManager", () => {
	it("creates 6-digit codes, dedupes names, caps players at 4", () => {
		const t = setup();
		const { s } = t.create("  Alice  ");
		assert.match(s.code, /^\d{6}$/);
		assert.ok(s.token.length >= 20);
		const b = t.join(s.code, "alice");
		t.join(s.code, "Alice");
		const l = t.m.get(s.code)!;
		assert.deepEqual(l.players.map((p) => p.name), ["Alice", "alice 2", "Alice 3"]);
		assert.equal(t.m.join(s.code, "   ").ok, false);
		t.join(s.code, "A very long name that overflows");
		assert.equal(l.players[3].name.length, 16);
		assert.deepEqual(t.m.join(s.code, "Eve"), { ok: false, error: "Lobby is full" });
		assert.deepEqual(t.m.join("000000x", "Eve"), { ok: false, error: "Lobby not found" });
		assert.equal(t.last.get(b.playerId)!.players.length, 4);
	});

	it("settings: host + LOBBY only, clamped", () => {
		const t = setup();
		const { s, lobby } = t.create();
		const b = t.join(s.code, "Bob");
		assert.equal(t.m.settings(s.code, b.playerId, 100).ok, false);
		t.ok(t.m.settings(s.code, s.playerId, 5));
		assert.equal(lobby.roundSeconds, 60);
		t.ok(t.m.settings(s.code, s.playerId, 9999));
		assert.equal(lobby.roundSeconds, 600);
		assert.equal(t.m.settings(s.code, s.playerId, "x").ok, false);
		assert.equal(t.m.start(s.code, b.playerId).ok, false);
		t.ok(t.m.start(s.code, s.playerId));
		assert.equal(t.m.settings(s.code, s.playerId, 100).ok, false);
		assert.equal(t.m.start(s.code, s.playerId).ok, false);
	});

	it("plays a full round with redaction, ranking, wins, and rotates the picker", async () => {
		const t = started(2, async () => ["crane", "flame"]);
		const [a, b] = t.players;
		const snapA = () => t.last.get(a.playerId)!;
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(snapA().pickerId, a.playerId);
		assert.equal(snapA().endsAt, t.clock.now() + 30_000);
		assert.equal(t.m.submitTheme(t.code, b.playerId, "x").ok, false);
		assert.equal(t.m.submitTheme(t.code, a.playerId, "   ").ok, false);
		assert.equal(t.m.guess(t.code, a.playerId, "crane").ok, false);

		t.ok(t.m.submitTheme(t.code, a.playerId, "birds"));
		assert.equal(t.lobby.phase, "GENERATING");
		assert.equal(snapA().theme, "birds");
		await flush();
		assert.equal(t.lobby.phase, "PLAYING");
		assert.equal(t.lobby.answer, "crane"); // random() = 0
		assert.equal(snapA().endsAt, t.clock.now() + 180_000);

		assert.deepEqual(t.m.guess(t.code, a.playerId, "zzzzz"), { ok: false, error: "Not in word list" });
		assert.deepEqual(t.m.guess(t.code, a.playerId, "abc"), { ok: false, error: "Not enough letters" });
		const g1 = t.ok(t.m.guess(t.code, a.playerId, "SLATE"));
		assert.deepEqual(g1.colors, row("bbgbg"));
		t.clock.advance(4000);
		t.ok(t.m.guess(t.code, b.playerId, "crane"));
		assert.equal(t.m.guess(t.code, b.playerId, "crane").ok, false); // done

		// Redaction: A sees own words, only B's colors.
		const sa = snapA();
		assert.deepEqual(sa.players.find((p) => p.id === a.playerId)!.words, ["slate"]);
		const bView = sa.players.find((p) => p.id === b.playerId)!;
		assert.equal(bView.words, undefined);
		assert.deepEqual(bView.colors, [row("ggggg")]);
		assert.equal(sa.results, undefined);
		assert.ok(!JSON.stringify(sa).includes("crane"));

		t.clock.advance(1000);
		t.ok(t.m.guess(t.code, a.playerId, "crane"));
		assert.equal(t.lobby.phase, "RESULTS");
		const res = snapA().results!;
		assert.equal(res.answer, "crane");
		assert.deepEqual(res.ranking.map((r) => [r.playerId, r.place, r.guesses, r.solveMs]), [
			[b.playerId, 1, 1, 4000],
			[a.playerId, 2, 2, 5000],
		]);
		assert.deepEqual(snapA().players.map((p) => p.wins), [0, 1]);
		assert.deepEqual(snapA().players.find((p) => p.id === b.playerId)!.words, ["crane"]);
		assert.equal(snapA().endsAt, undefined);
		assert.equal(t.clock.pending, 0, "round timer cleared");

		t.ok(t.m.ready(t.code, a.playerId, true));
		assert.equal(t.lobby.phase, "RESULTS");
		t.ok(t.m.ready(t.code, b.playerId, true));
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.roundId, 2);
		assert.equal(t.lobby.pickerId, b.playerId);
		assert.deepEqual(snapA().players.map((p) => p.colors.length), [0, 0]);

		// Used answers are excluded: next answer must be "pious".
		await toPlaying(t, 1);
		assert.equal(t.lobby.answer, "flame");
	});

	it("round timer ends the round; unsolved ranked by best row", async () => {
		const t = started(2);
		await toPlaying(t);
		const [a, b] = t.players;
		t.ok(t.m.guess(t.code, a.playerId, "crate")); // ggggb... c r a t e vs crane: g g g b g
		t.ok(t.m.guess(t.code, b.playerId, "slate"));
		t.clock.advance(180_000);
		assert.equal(t.lobby.phase, "RESULTS");
		const r = t.lobby.results!.ranking;
		assert.deepEqual(r.map((e) => [e.playerId, e.place, e.solved]), [[a.playerId, 1, false], [b.playerId, 2, false]]);
		assert.deepEqual(t.lobby.players.map((p) => p.wins), [0, 0], "no win without solving");
		assert.ok(t.lobby.players.every((p) => p.done));
	});

	it("six wrong guesses makes a player done", async () => {
		const t = started(1);
		await toPlaying(t);
		for (let i = 0; i < 5; i++) t.ok(t.m.guess(t.code, t.players[0].playerId, "slate"));
		assert.equal(t.lobby.phase, "PLAYING");
		t.ok(t.m.guess(t.code, t.players[0].playerId, "slate"));
		assert.equal(t.lobby.phase, "RESULTS");
	});

	it("theme pick timeout skips the picker, full rotation uses a preset", async () => {
		const t = started(2);
		const [a, b] = t.players;
		t.clock.advance(30_000);
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.pickerId, b.playerId);
		assert.match(t.last.get(a.playerId)!.notice!, /Alice ran out of time.*Bob picks/);
		assert.equal(t.m.submitTheme(t.code, a.playerId, "x").ok, false);
		t.clock.advance(30_000);
		assert.equal(t.lobby.phase, "GENERATING");
		assert.equal(t.lobby.theme, PRESET_THEMES[0]);
		assert.equal(t.last.get(a.playerId)!.pickerId, undefined);
		await flush();
		assert.equal(t.lobby.phase, "PLAYING");
		// Next round's picker continues after Bob (wraps to Alice).
		t.ok(t.m.guess(t.code, a.playerId, "crane"));
		t.ok(t.m.guess(t.code, b.playerId, "crane"));
		t.m.ready(t.code, a.playerId, true);
		t.m.ready(t.code, b.playerId, true);
		assert.equal(t.lobby.pickerId, a.playerId);
	});

	it("ThemeError returns to the same picker with the message; notice is one-off", async () => {
		const t = started(2, async () => { throw new ThemeError("Too narrow"); });
		const [a, b] = t.players;
		t.clock.advance(10_000);
		t.ok(t.m.submitTheme(t.code, a.playerId, "zzz"));
		await flush();
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.pickerId, a.playerId);
		assert.equal(t.last.get(b.playerId)!.notice, "Too narrow");
		assert.equal(t.last.get(b.playerId)!.endsAt, t.clock.now() + 30_000);
		assert.equal(t.last.get(b.playerId)!.theme, undefined);
		// Notice is one-off: the next change doesn't repeat it.
		t.ok(t.m.submitTheme(t.code, a.playerId, "zzz"));
		assert.equal(t.last.get(b.playerId)!.notice, undefined);
	});

	it("generator failure and timeout fall back to a random unused word", async () => {
		const t = started(1, async () => { throw new Error("boom"); });
		await toPlaying(t);
		assert.equal(t.last.get(t.players[0].playerId)!.notice, GENERATOR_UNAVAILABLE);
		assert.ok(t.lobby.answer);

		const t2 = started(1, () => new Promise(() => {}));
		t2.ok(t2.m.submitTheme(t2.code, t2.players[0].playerId, "x"));
		t2.clock.advance(19_999);
		assert.equal(t2.lobby.phase, "GENERATING");
		t2.clock.advance(1);
		assert.equal(t2.lobby.phase, "PLAYING");
		assert.equal(t2.last.get(t2.players[0].playerId)!.notice, GENERATOR_UNAVAILABLE);
	});

	it("discards stale generation results", async () => {
		let resolve!: (w: string[]) => void;
		const t = started(1, () => new Promise((r) => (resolve = r)));
		t.ok(t.m.submitTheme(t.code, t.players[0].playerId, "x"));
		await flush();
		t.clock.advance(20_000); // timeout -> fallback word
		const answer = t.lobby.answer;
		resolve(["flame"]);
		await flush();
		assert.equal(t.lobby.answer, answer);
		assert.equal(t.lobby.phase, "PLAYING");
	});

	it("rejects ready outside LOBBY/RESULTS", async () => {
		const t = started(1);
		await toPlaying(t);
		assert.equal(t.m.ready(t.code, t.players[0].playerId, true).ok, false);
	});

	it("disconnect in PLAYING waits for grace, then marks done and ends the round", async () => {
		const t = started(2);
		await toPlaying(t);
		const [a, b] = t.players;
		t.ok(t.m.guess(t.code, a.playerId, "crane"));
		t.m.disconnect(t.code, b.playerId);
		assert.equal(t.lobby.phase, "PLAYING");
		assert.equal(t.last.get(a.playerId)!.players[1].connected, false);
		t.clock.advance(30_000);
		assert.equal(t.lobby.phase, "RESULTS");
		assert.equal(t.lobby.players.length, 2, "kept for results");
		// Expired player is dropped when the next round begins.
		t.ok(t.m.ready(t.code, a.playerId, true));
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.deepEqual(t.lobby.players.map((p) => p.id), [a.playerId]);
	});

	it("rejoin within grace restores the player", async () => {
		const t = started(2);
		await toPlaying(t);
		const [, b] = t.players;
		t.ok(t.m.guess(t.code, b.playerId, "slate"));
		t.m.disconnect(t.code, b.playerId);
		assert.deepEqual(t.m.rejoin(t.code, b.playerId, "wrong"), { ok: false, error: "Session expired" });
		t.ok(t.m.rejoin(t.code, b.playerId, b.token));
		t.clock.advance(60_000);
		const p = t.lobby.players[1];
		assert.equal(p.connected, true);
		assert.deepEqual(p.words, ["slate"]);
		assert.equal(t.lobby.phase, "PLAYING");
		assert.equal(p.done, false);
	});

	it("grace expiry in LOBBY removes the player and migrates host", () => {
		const t = setup();
		const { s, lobby } = t.create("Alice");
		const b = t.join(s.code, "Bob");
		const c = t.join(s.code, "Cara");
		t.m.disconnect(s.code, b.playerId);
		t.m.disconnect(s.code, s.playerId);
		t.clock.advance(30_000);
		assert.deepEqual(lobby.players.map((p) => p.name), ["Cara"]);
		assert.equal(lobby.hostId, c.playerId);
		assert.deepEqual(t.removed.map((r) => r.reason), ["Disconnected for too long", "Disconnected for too long"]);
	});

	it("explicit leave removes immediately; host passes to longest-present connected player", () => {
		const t = setup();
		const { s, lobby } = t.create("Alice");
		const b = t.join(s.code, "Bob");
		const c = t.join(s.code, "Cara");
		t.m.disconnect(s.code, b.playerId);
		t.m.leave(s.code, s.playerId);
		assert.equal(lobby.hostId, c.playerId); // Bob is disconnected
		assert.match(t.last.get(c.playerId)!.notice!, /Alice left.*Cara is now the host/);
		assert.equal(t.last.get(c.playerId)!.notice !== undefined, true);
		assert.equal(lobby.notice, undefined, "notice cleared after publish");
	});

	it("picker leaving during THEME_PICK passes the pick on", () => {
		const t = started(3);
		const [a, b] = t.players;
		t.m.leave(t.code, a.playerId);
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.pickerId, b.playerId);
		assert.equal(t.lobby.hostId, b.playerId);
	});

	it("player leaving mid-round can end the round", async () => {
		const t = started(2);
		await toPlaying(t);
		t.ok(t.m.guess(t.code, t.players[0].playerId, "crane"));
		t.m.leave(t.code, t.players[1].playerId);
		assert.equal(t.lobby.phase, "RESULTS");
		assert.equal(t.lobby.results!.ranking.length, 1);
	});

	it("mid-round joiners spectate until the next round", async () => {
		const t = started(1);
		await toPlaying(t);
		const d = t.join(t.code, "Dan");
		assert.equal(t.lobby.players[1].spectating, true);
		assert.deepEqual(t.m.guess(t.code, d.playerId, "crane"), { ok: false, error: "You're spectating this round" });
		t.ok(t.m.guess(t.code, t.players[0].playerId, "crane"));
		assert.equal(t.lobby.results!.ranking.length, 1);
		t.ok(t.m.ready(t.code, t.players[0].playerId, true)); // spectator need not be ready
		assert.equal(t.lobby.phase, "THEME_PICK");
		assert.equal(t.lobby.players[1].spectating, false);
	});

	it("deletes the lobby 5 minutes after nobody is connected, leaving no timers", async () => {
		const t = started(2);
		await toPlaying(t);
		t.m.disconnect(t.code, t.players[0].playerId);
		t.m.disconnect(t.code, t.players[1].playerId);
		t.clock.advance(299_999);
		assert.ok(t.m.get(t.code));
		t.clock.advance(1);
		assert.equal(t.m.get(t.code), undefined);
		assert.equal(t.clock.pending, 0);
	});

	it("dispose clears every timer", async () => {
		const t = started(2);
		await toPlaying(t);
		t.m.disconnect(t.code, t.players[1].playerId);
		assert.ok(t.clock.pending > 0);
		t.m.dispose();
		assert.equal(t.clock.pending, 0);
		assert.equal(t.m.lobbies.size, 0);
	});
});
