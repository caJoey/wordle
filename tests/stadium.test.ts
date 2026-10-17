import { test } from "node:test";
import assert from "node:assert/strict";
import type { LetterState, PlayerView } from "../shared/protocol";
import { commentary, form, levelFor, rowScore, StadiumTracker } from "../src/stadium";

const row = (s: string) => [...s].map((c) => ({ g: "🟩", y: "🟨", x: "⬛" }[c])) as LetterState[];

function player(id: string, rows: string[], extra: Partial<PlayerView> = {}): PlayerView {
	const colors = rows.map(row);
	const solved = rows.at(-1) === "ggggg";
	return {
		id, name: id, connected: true, isHost: false, ready: false, colors,
		solved, done: solved || rows.length >= 6, spectating: false, wins: 0, ...extra,
	};
}

test("rowScore: 2 per green, 1 per yellow", () => {
	assert.equal(rowScore(row("xxxxx")), 0);
	assert.equal(rowScore(row("gyxxx")), 3);
	assert.equal(rowScore(row("ggggg")), 10);
});

test("form is 1 when solved and grows with the best row", () => {
	assert.equal(form([]), 0);
	assert.equal(form([row("xxxxx"), row("ggggg")]), 1);
	assert.ok(form([row("ggyxx")]) > form([row("gxxxx")]));
});

test("levels", () => {
	assert.equal(levelFor(0).tier, 0);
	assert.equal(levelFor(65).tier, 3);
	assert.equal(levelFor(100).tier, 5);
});

test("first update is silent so a reload doesn't replay every guess", () => {
	const t = new StadiumTracker();
	assert.deepEqual(t.update([player("a", ["ggyxx", "ggggg"]), player("b", [])], 0), []);
});

test("big jump is a cook, a whiff is a gasp, and the crowd meter follows", () => {
	const t = new StadiumTracker();
	t.update([player("a", []), player("b", [])], 0);
	const events = t.update([player("a", ["gggyx"]), player("b", ["yxxxx"])], 1000);
	assert.deepEqual(events.map((e) => [e.type, e.playerId]), [["cook", "a"]]);
	const gasp = t.update([player("a", ["gggyx"]), player("b", ["yxxxx", "xxxxx"])], 2000);
	assert.deepEqual(gasp.map((e) => e.type), ["gasp"]);
	const hype = Object.fromEntries(t.hypes([player("a", ["gggyx"]), player("b", ["yxxxx", "xxxxx"])], 2000).map((h) => [h.id, h.hype]));
	assert.ok(hype.a > 60, `a should be cooking, got ${hype.a}`);
	assert.ok(hype.b < hype.a);
});

test("solve pins the meter and only the first solver is first", () => {
	const t = new StadiumTracker();
	t.update([player("a", []), player("b", [])], 0);
	const [first] = t.update([player("a", ["ggggg"]), player("b", [])], 1000);
	assert.equal(first.type, "solve");
	assert.equal(first.first, true);
	const [second] = t.update([player("a", ["ggggg"]), player("b", ["ggggg"])], 2000);
	assert.equal(second.first, false);
	assert.ok(t.hypes([player("a", ["ggggg"])], 2000).every((h) => h.hype === 100));
});

test("running out of guesses is a fail and drops the meter", () => {
	const t = new StadiumTracker();
	const five = ["yxxxx", "yxxxx", "yxxxx", "yxxxx", "yxxxx"];
	t.update([player("a", five)], 0);
	const events = t.update([player("a", [...five, "yxxxx"])], 1000);
	assert.ok(events.some((e) => e.type === "fail"));
	assert.ok(t.hypes([player("a", [...five, "yxxxx"])], 1000)[0].hype <= 12);
});

test("momentum fades back toward form", () => {
	const t = new StadiumTracker();
	t.update([player("a", []), player("b", [])], 0);
	const players = [player("a", ["gggyx"]), player("b", ["yxxxx"])];
	t.update(players, 1000);
	const hot = t.hypes(players, 1000)[0].hype;
	const later = t.hypes(players, 60000)[0].hype;
	assert.ok(later < hot);
});

test("commentary names the player, and says YOU for yourself", () => {
	const e = { type: "cook" as const, playerId: "a", guesses: 3 };
	assert.equal(commentary(e, "Troy", false, () => 0), "OH TROY'S COOKING 🔥");
	assert.equal(commentary(e, "Troy", true, () => 0), "OH YOU'RE COOKING 🔥");
	assert.equal(commentary({ ...e, type: "solve", guesses: 2 }, "Troy", false, () => 0), "NO WAY. CHAT IS THIS REAL 🤯");
});
