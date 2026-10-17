import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { io, type Socket } from "socket.io-client";
import type { Ack, ClientToServerEvents, LobbySnapshot, ServerToClientEvents, Session } from "../../shared/protocol";
import { createServer, type CreateServerOptions, type GameServer } from "../app";
import { silentLogger } from "./helpers";

const POOL = ["crane", "slate", "flame", "grape"];

class Client {
	sock: Socket<ServerToClientEvents, ClientToServerEvents>;
	snaps: LobbySnapshot[] = [];
	closed: string[] = [];
	session?: Session;
	private waiters: (() => void)[] = [];

	constructor(url: string) {
		this.sock = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
		this.sock.on("lobby:snapshot", (s) => {
			this.snaps.push(s);
			this.waiters.forEach((w) => w());
		});
		this.sock.on("lobby:closed", ({ reason }) => this.closed.push(reason));
	}

	get last() {
		return this.snaps[this.snaps.length - 1];
	}

	connected() {
		return new Promise<void>((resolve, reject) => {
			if (this.sock.connected) return resolve();
			this.sock.once("connect", () => resolve());
			this.sock.once("connect_error", reject);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	call<T = {}>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack<T>> {
		return (this.sock.timeout(3000) as any).emitWithAck(event, ...args);
	}

	async ok<T = {}>(event: keyof ClientToServerEvents, ...args: unknown[]) {
		const r = await this.call<T>(event, ...args);
		assert.ok(r.ok, `${event} failed: ${JSON.stringify(r)}`);
		return r as { ok: true; } & T;
	}

	/** Resolve with the first snapshot (latest or upcoming) matching pred. */
	waitFor(pred: (s: LobbySnapshot) => boolean, ms = 3000) {
		return new Promise<LobbySnapshot>((resolve, reject) => {
			const check = () => {
				const s = this.last;
				if (s && pred(s)) {
					clearTimeout(timer);
					this.waiters = this.waiters.filter((w) => w !== check);
					resolve(s);
				}
			};
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((w) => w !== check);
				reject(new Error(`waitFor timed out; last snapshot: ${JSON.stringify(this.last)}`));
			}, ms);
			this.waiters.push(check);
			check();
		});
	}

	close() {
		this.sock.disconnect();
	}
}

async function boot(opts: CreateServerOptions) {
	const server = createServer({ logger: silentLogger, serveClient: false, ...opts });
	const port = await server.listen(0);
	const url = `http://127.0.0.1:${port}`;
	const clients: Client[] = [];
	const client = async () => {
		const c = new Client(url);
		clients.push(c);
		await c.connected();
		return c;
	};
	const shutdown = async () => {
		clients.forEach((c) => c.close());
		await server.close();
	};
	return { server, url, client, shutdown };
}

const me = (s: LobbySnapshot) => s.players.find((p) => p.id === s.youId)!;
const byName = (s: LobbySnapshot, name: string) => s.players.find((p) => p.name === name)!;

describe("e2e: full game over socket.io", () => {
	let env: Awaited<ReturnType<typeof boot>>;
	before(async () => {
		env = await boot({
			generatePool: async (_theme, exclude) => POOL.filter((w) => !exclude?.includes(w)),
			random: () => 0,
			timings: { themePickMs: 10_000, graceMs: 2_000, generateTimeoutMs: 2_000, emptyLobbyMs: 1_000 },
		});
	});
	after(() => env.shutdown());

	it("plays two rounds with redaction, ranking, ready-up, reconnect and leave", async () => {
		const alice = await env.client();
		const bob = await env.client();
		const cara = await env.client();

		// --- create / join
		const sa = await alice.ok<Session>("lobby:create", { name: "Alice" });
		assert.match(sa.code, /^\d{6}$/);
		const code = sa.code;
		const sb = await bob.ok<Session>("lobby:join", { code, name: "Bob" });
		await cara.ok<Session>("lobby:join", { code, name: "Bob" }); // dedupes
		await alice.waitFor((s) => s.players.length === 3);
		assert.deepEqual(alice.last.players.map((p) => p.name), ["Alice", "Bob", "Bob 2"]);
		assert.equal(alice.last.players[0].isHost, true);
		assert.equal((await bob.call("lobby:join", { code: "999999x", name: "X" })).ok, false);

		// --- start
		assert.deepEqual(await bob.call("game:start"), { ok: false, error: "Only the host can start the game" });
		await alice.ok("game:start");
		let s = await bob.waitFor((x) => x.phase === "THEME_PICK");
		assert.equal(s.pickerId, sa.playerId);
		assert.equal(s.roundId, 1);
		assert.ok(s.endsAt! > s.serverNow);
		assert.equal((await bob.call("theme:submit", { theme: "fruit" })).ok, false);

		// --- theme -> PLAYING
		await alice.ok("theme:submit", { theme: "fruit" });
		s = await bob.waitFor((x) => x.phase === "PLAYING");
		assert.equal(s.theme, "fruit");

		// --- guesses
		assert.deepEqual(await alice.call("guess:submit", { word: "zzzzz" }), { ok: false, error: "Not in word list" });
		const g = await alice.ok<{ colors: string[]; }>("guess:submit", { word: "slate" });
		assert.equal(g.colors.length, 5);
		const bobView = await bob.waitFor((x) => byName(x, "Alice").colors.length === 1);
		assert.equal(byName(bobView, "Alice").words, undefined, "opponent words hidden while PLAYING");
		assert.deepEqual(byName(bobView, "Alice").colors, [g.colors]);
		assert.deepEqual(me(await alice.waitFor((x) => me(x).colors.length === 1)).words, ["slate"]);

		await bob.ok("guess:submit", { word: "crane" }); // bob solves in 1
		await alice.ok("guess:submit", { word: "crane" }); // alice solves in 2
		await cara.ok("guess:submit", { word: "grape" });
		await alice.waitFor((x) => byName(x, "Bob 2").colors.length === 1);
		assert.equal(alice.last.phase, "PLAYING", "cara still playing");

		// No opponent words and no answer leaked to anyone before RESULTS.
		for (const c of [alice, bob, cara]) {
			for (const snap of c.snaps.filter((x) => x.phase !== "RESULTS")) {
				assert.equal(snap.results, undefined);
				for (const p of snap.players) if (p.id !== snap.youId) assert.equal(p.words, undefined);
			}
		}
		assert.ok(!JSON.stringify(cara.snaps).includes("crane"), "cara never saw the answer");

		// --- cara leaves mid-round -> everyone left is done -> RESULTS
		cara.sock.emit("lobby:leave");
		s = await alice.waitFor((x) => x.phase === "RESULTS");
		assert.match(s.notice ?? "", /Bob 2 left/);
		assert.equal(s.players.length, 2);
		assert.equal(s.results!.answer, "crane");
		assert.equal(s.results!.theme, "fruit");
		assert.deepEqual(s.results!.ranking.map((r) => [r.playerId, r.place, r.guesses]), [
			[sb.playerId, 1, 1],
			[sa.playerId, 2, 2],
		]);
		assert.ok(s.results!.ranking[0].solveMs! <= s.results!.ranking[1].solveMs!);
		assert.equal(byName(s, "Bob").wins, 1);
		assert.deepEqual(byName(s, "Bob").words, ["crane"], "words revealed in RESULTS");
		assert.equal(s.endsAt, undefined);

		// --- ready up -> round 2, bob picks
		assert.equal((await alice.call("guess:submit", { word: "crane" })).ok, false);
		await alice.ok("player:ready", { ready: true });
		assert.equal((await bob.waitFor((x) => byName(x, "Alice").ready)).phase, "RESULTS");
		await bob.ok("player:ready", { ready: true });
		s = await alice.waitFor((x) => x.phase === "THEME_PICK" && x.roundId === 2);
		assert.equal(s.pickerId, sb.playerId);
		assert.ok(s.players.every((p) => p.colors.length === 0 && !p.ready));
		assert.equal(s.results, undefined);

		await bob.ok("theme:submit", { theme: "kitchen" });
		await alice.waitFor((x) => x.phase === "PLAYING" && x.roundId === 2);
		await bob.ok("guess:submit", { word: "flame" });

		// --- bob disconnects and reconnects with his token
		bob.close();
		await alice.waitFor((x) => byName(x, "Bob").connected === false);
		const bob2 = await env.client();
		assert.deepEqual(await bob2.call("lobby:join", { code, name: "", playerId: sb.playerId, token: "nope" }), { ok: false, error: "Session expired" });
		const re = await bob2.ok<Session>("lobby:join", { code, name: "", playerId: sb.playerId, token: sb.token });
		assert.equal(re.playerId, sb.playerId);
		s = await bob2.waitFor((x) => x.phase === "PLAYING");
		assert.deepEqual(me(s).words, ["flame"], "state restored");
		assert.equal(me(s).wins, 1);
		await alice.waitFor((x) => byName(x, "Bob").connected === true);

		// Answer for round 2 excludes "crane" -> "slate".
		await bob2.ok("guess:submit", { word: "slate" });
		await alice.ok("guess:submit", { word: "slate" });
		s = await alice.waitFor((x) => x.phase === "RESULTS" && x.roundId === 2);
		assert.equal(s.results!.answer, "slate");
		assert.equal(s.results!.ranking[0].playerId, sa.playerId); // 1 guess vs 2
		assert.deepEqual(s.players.map((p) => p.wins), [1, 1]);
	});

	it("a new socket taking over a session closes the old one", async () => {
		const a = await env.client();
		const sa = await a.ok<Session>("lobby:create", { name: "Solo" });
		const a2 = await env.client();
		await a2.ok("lobby:join", { code: sa.code, name: "", playerId: sa.playerId, token: sa.token });
		await new Promise((r) => setTimeout(r, 50));
		assert.deepEqual(a.closed, ["You joined from another tab"]);
		assert.deepEqual(await a.call("game:start"), { ok: false, error: "Not in a lobby" });
		await a2.ok("game:start"); // solo game is allowed
	});
});

describe("e2e: theme pick timeout", () => {
	let env: Awaited<ReturnType<typeof boot>>;
	before(async () => {
		env = await boot({
			generatePool: async () => POOL,
			random: () => 0,
			timings: { themePickMs: 300, graceMs: 2_000, generateTimeoutMs: 2_000, emptyLobbyMs: 1_000 },
		});
	});
	after(() => env.shutdown());

	it("skips a picker who runs out of time", async () => {
		const alice = await env.client();
		const bob = await env.client();
		const sa = await alice.ok<Session>("lobby:create", { name: "Alice" });
		const sb = await bob.ok<Session>("lobby:join", { code: sa.code, name: "Bob" });
		await alice.ok("game:start");
		const s = await bob.waitFor((x) => x.phase === "THEME_PICK" && x.pickerId === sb.playerId);
		assert.match(s.notice ?? "", /Alice ran out of time/);
		assert.equal((await alice.call("theme:submit", { theme: "late" })).ok, false);
		await bob.ok("theme:submit", { theme: "space" });
		await alice.waitFor((x) => x.phase === "PLAYING" && x.theme === "space");
	});
});

describe("e2e: serves the built client in production mode", () => {
	let dir: string;
	let env: Awaited<ReturnType<typeof boot>>;
	before(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "wordle-dist-"));
		await writeFile(path.join(dir, "index.html"), "<!doctype html><title>spa</title>");
		await writeFile(path.join(dir, "app.js"), "console.log(1)");
		env = await boot({ generatePool: async () => POOL, serveClient: true, distDir: dir });
	});
	after(async () => {
		await env.shutdown();
		await rm(dir, { recursive: true, force: true });
	});

	it("serves static files with SPA fallback", async () => {
		assert.equal(await (await fetch(`${env.url}/app.js`)).text(), "console.log(1)");
		const res = await fetch(`${env.url}/lobby/123456`);
		assert.equal(res.status, 200);
		assert.match(await res.text(), /<title>spa<\/title>/);
	});
});
