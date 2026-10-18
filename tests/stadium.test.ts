import { test } from "node:test";
import assert from "node:assert/strict";
import type { LetterState, PlayerView } from "../shared/protocol";
import { beats, commentary, form, levelFor, outlook, rowScore, StadiumTracker } from "../src/stadium";

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

const meter = (t: StadiumTracker, players: PlayerView[], now: number) => t.hypes(players, now).find((h) => h.id === "you")!.hype;

/** Your meter with no bursts: just your form and what's at stake. */
function settled(players: PlayerView[]) {
	const t = new StadiumTracker();
	t.update(players, 0);
	return meter(t, players, 0);
}

/** How far your meter moves as the lobby goes from `before` to `after`. */
function reaction(before: PlayerView[], after: PlayerView[]) {
	const t = new StadiumTracker();
	t.update(before, 0);
	const was = meter(t, before, 0);
	t.update(after, 1000);
	return meter(t, after, 1000) - was;
}

test("the race model ranks like the server: solvers first, then fewer guesses, then sooner", () => {
	const fresh = outlook(player("a", []));
	const expected = fresh.chance.reduce((sum, c, k) => sum + c * k, 0);
	assert.ok(expected > 3.7 && expected < 4.5, `a round takes about 4 guesses, got ${expected}`);
	const solvedIn3 = outlook(player("w", ["xxxxx", "yyxxx", "ggggg"], { solveMs: 30000 }));
	// Two guesses down, the best you can do is tie on guesses, and they got there first
	assert.equal(beats(outlook(player("you", ["xxxxx", "gggxx"])), solvedIn3), 0);
	const oneDown = beats(outlook(player("you", ["gggxx"])), solvedIn3);
	assert.ok(oneDown > 0.1 && oneDown < 0.6, `has to solve with the next guess: ${oneDown}`);
	const a = outlook(player("a", ["ggxxx"]));
	const b = outlook(player("b", ["xxxxx", "yyyxx"]));
	assert.ok(Math.abs(beats(a, b) + beats(b, a) - 1) < 1e-9);
	const quick = outlook(player("q", ["xxxxx", "ggggg"], { solveMs: 20000 }));
	const slow = outlook(player("s", ["xxxxx", "ggggg"], { solveMs: 40000 }));
	assert.equal(beats(quick, slow), 1);
});

test("a tight race late in the round is higher stakes than a lopsided or an early one", () => {
	const tight = settled([player("you", ["xxxxx", "yxxxx", "gggxx"]), player("r", ["xxxxx", "xyxxx", "gxggx"])]);
	const lopsided = settled([player("you", ["xxxxx", "yxxxx", "gggxx"]), player("r", ["xxxxx", "xxxxx", "xxxxx"])]);
	const early = settled([player("you", ["yxxxx"]), player("r", ["xyxxx"])]);
	assert.ok(tight >= 80, `tight race: ${tight}`);
	assert.ok(tight > lopsided + 20, `tight ${tight} vs lopsided ${lopsided}`);
	assert.ok(early < 30, `early: ${early}`);
});

test("after a rival solves, it's do or die if you can still beat them and over if you can't", () => {
	const rival = player("r", ["xxxxx", "yyxxx", "gxgxx", "ggggg"], { solveMs: 60000 });
	const alive = settled([player("you", ["xxxxx", "gggxx"]), rival]);
	const beaten = settled([player("you", ["xxxxx", "yxxxx", "gggxx"]), rival]);
	assert.ok(alive >= 70, `still in it: ${alive}`);
	assert.ok(beaten < 45, `can't win any more: ${beaten}`);
});

test("a rival's big guess ramps up your meter in a tight race and barely registers from someone out of it", () => {
	const tight = reaction(
		[player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx"])],
		[player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx", "ggggx"])],
	);
	assert.ok(tight >= 15, `head to head: ${tight}`);
	// Someone solved in 2, so neither of you can win this round
	const winner = player("w", ["xxxxx", "ggggg"], { solveMs: 20000 });
	const outOfIt = reaction(
		[player("you", ["ggxxx"]), winner, player("r", ["xxxxx", "xxxxx"])],
		[player("you", ["ggxxx"]), winner, player("r", ["xxxxx", "xxxxx", "ggggx"])],
	);
	assert.ok(Math.abs(outOfIt) <= 1, `out of it: ${outOfIt}`);
	// The back of a big lobby is too far off to matter
	const pack = Array.from({ length: 20 }, (_, i) => player(`p${i}`, ["xxxxx", "yyxxx", "ggxxx"]));
	const backmarker = reaction(
		[player("you", ["xxxxx", "yxxxx", "gggxx"]), ...pack, player("b", ["xxxxx", "xxxxx", "xxxxx"])],
		[player("you", ["xxxxx", "yxxxx", "gggxx"]), ...pack, player("b", ["xxxxx", "xxxxx", "xxxxx", "gggyx"])],
	);
	assert.ok(Math.abs(backmarker) <= 1, `backmarker: ${backmarker}`);
});

test("a rival's whiff in a tight race takes a little air out", () => {
	const before = [player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx"])];
	const whiff = reaction(before, [player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx", "xxxxx"])]);
	const cook = reaction(before, [player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx", "ggggx"])]);
	assert.ok(whiff < 0 && whiff > -15, `whiff: ${whiff}`);
	assert.ok(cook > -whiff, `a cook (${cook}) should land harder than a whiff (${whiff})`);
});

test("when a rival's solve settles your race, the crowd erupts before it goes quiet", () => {
	const before = [player("you", ["xxxxx", "yxxxx", "gggxx"]), player("r", ["xxxxx", "xyxxx", "gxggx"])];
	const after = [before[0], player("r", ["xxxxx", "xyxxx", "gxggx", "ggggg"], { solveMs: 60000 })];
	const t = new StadiumTracker();
	t.update(before, 0);
	const was = meter(t, before, 0);
	t.update(after, 1000);
	assert.ok(meter(t, after, 1000) >= was);
	assert.ok(meter(t, after, 60000) < was - 30);
});

test("your own big guess moves the crowd more when the race is on the line", () => {
	const inRace = reaction(
		[player("you", ["xxxxx", "ggxxx"]), player("r", ["xxxxx", "xxggx"])],
		[player("you", ["xxxxx", "ggxxx", "ggggx"]), player("r", ["xxxxx", "xxggx"])],
	);
	const alone = reaction([player("you", ["xxxxx", "ggxxx"])], [player("you", ["xxxxx", "ggxxx", "ggggx"])]);
	assert.ok(inRace > alone, `in a race ${inRace} vs alone ${alone}`);
});

test("a lead change is called once the favorite flips, not on every wobble", () => {
	const t = new StadiumTracker();
	t.update([player("a", ["xxxxx", "gggxx"]), player("b", ["xxxxx", "xxxxx"])], 0);
	const cook = t.update([player("a", ["xxxxx", "gggxx"]), player("b", ["xxxxx", "xxxxx", "ggggx"])], 10000);
	assert.ok(!cook.some((e) => e.type === "lead"));
	const flip = t.update([player("a", ["xxxxx", "gggxx", "xxxxx"]), player("b", ["xxxxx", "xxxxx", "ggggx"])], 20000);
	assert.deepEqual(flip.filter((e) => e.type === "lead").map((e) => e.playerId), ["b"]);
});

test("commentary names the player, and says YOU for yourself", () => {
	const e = { type: "cook" as const, playerId: "a", guesses: 3 };
	assert.equal(commentary(e, "Troy", false, () => 0), "OH TROY'S COOKING 🔥");
	assert.equal(commentary(e, "Troy", true, () => 0), "OH YOU'RE COOKING 🔥");
	assert.equal(commentary({ ...e, type: "solve", guesses: 2 }, "Troy", false, () => 0), "NO WAY. CHAT IS THIS REAL 🤯");
});
