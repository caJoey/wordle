import express from "express";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import type { Ack, ClientToServerEvents, ServerToClientEvents } from "../shared/protocol";
import { LobbyManager, type BotGuess, type GeneratePool, type Scheduler, type Timings } from "./lobby";

/** Loaded on first use so the Gemma client is only required when no stub is injected. */
const gemmaGeneratePool: GeneratePool = async (theme, exclude) => {
	const { generatePool } = await import("./words/gemma");
	return (generatePool as GeneratePool)(theme, exclude);
};

const gemmaBotGuess: BotGuess = async (turn) => {
	const { botGuess } = await import("./words/bot");
	return botGuess(turn);
};

type SocketData = { code?: string; playerId?: string; };
export type GameIO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export interface CreateServerOptions {
	generatePool?: GeneratePool;
	botGuess?: BotGuess;
	timings?: Partial<Timings>;
	/** See LobbyManagerOptions.publishDelayMs. Default 0 (tests); index.ts batches. */
	publishDelayMs?: number;
	scheduler?: Scheduler;
	random?: () => number;
	/** Serve the built client from `distDir` with SPA fallback. Default: NODE_ENV === "production". */
	serveClient?: boolean;
	distDir?: string;
	logger?: Pick<Console, "error" | "log">;
}

export interface GameServer {
	app: express.Express;
	httpServer: HttpServer;
	io: GameIO;
	manager: LobbyManager;
	/** Resolves with the bound port (pass 0 for a random one). */
	listen(port?: number): Promise<number>;
	close(): Promise<void>;
}

const DEFAULT_DIST = fileURLToPath(new URL("../dist", import.meta.url));

export function createServer(opts: CreateServerOptions = {}): GameServer {
	const production = process.env.NODE_ENV === "production";
	const app = express();
	const httpServer = createHttpServer(app);
	// Snapshots are mostly repeated emoji and keys, so compression shrinks them several times over
	const io: GameIO = new Server(httpServer, {
		perMessageDeflate: { threshold: 1024 },
		...(production ? {} : { cors: { origin: true } }),
	});

	/** playerId -> the socket currently bound to that player. */
	const sockets = new Map<string, GameSocket>();

	const unbind = (s: GameSocket) => {
		const { playerId } = s.data;
		if (playerId && sockets.get(playerId) === s) sockets.delete(playerId);
		s.data.code = s.data.playerId = undefined;
	};

	const manager = new LobbyManager({
		generatePool: opts.generatePool ?? gemmaGeneratePool,
		botGuess: opts.botGuess ?? gemmaBotGuess,
		publishDelayMs: opts.publishDelayMs,
		timings: opts.timings,
		scheduler: opts.scheduler,
		random: opts.random,
		logger: opts.logger,
		hooks: {
			onUpdate(lobby) {
				for (const p of lobby.players) sockets.get(p.id)?.emit("lobby:snapshot", manager.snapshot(lobby, p.id));
			},
			onRemoved(_lobby, playerId, reason) {
				const s = sockets.get(playerId);
				if (!s) return;
				unbind(s);
				if (reason) s.emit("lobby:closed", { reason });
			},
			onDeleted(lobby) {
				for (const p of lobby.players) {
					const s = sockets.get(p.id);
					if (!s) continue;
					unbind(s);
					s.emit("lobby:closed", { reason: "The lobby was closed" });
				}
			},
		},
	});

	io.on("connection", (socket: GameSocket) => {
		/** Run a handler, always answering through the ack (if any) and never throwing. */
		const handle = <T>(ack: unknown, fn: () => Ack<T>) => {
			const reply = typeof ack === "function" ? (ack as (r: Ack<T>) => void) : () => {};
			try {
				reply(fn());
			} catch (e) {
				console.error("handler error:", e);
				reply({ ok: false, error: "Server error" });
			}
		};
		const inLobby = <T>(fn: (code: string, playerId: string) => Ack<T>) => (): Ack<T> => {
			const { code, playerId } = socket.data;
			if (!code || !playerId || sockets.get(playerId) !== socket) return { ok: false, error: "Not in a lobby" };
			return fn(code, playerId);
		};
		const leaveCurrent = () => {
			const { code, playerId } = socket.data;
			const bound = playerId && sockets.get(playerId) === socket;
			unbind(socket);
			if (code && playerId && bound) manager.leave(code, playerId);
		};
		const bind = (code: string, playerId: string) => {
			const old = sockets.get(playerId);
			if (old && old !== socket) {
				unbind(old);
				old.emit("lobby:closed", { reason: "You joined from another tab" });
			}
			socket.data.code = code;
			socket.data.playerId = playerId;
			sockets.set(playerId, socket);
		};
		const enter = (res: Ack<{ code: string; playerId: string; token: string; }>, ack: unknown) => {
			const reply = typeof ack === "function" ? ack : () => {};
			if (res.ok) {
				// Only now leave the previous lobby, so a failed join doesn't drop the player.
				if (socket.data.playerId !== res.playerId) leaveCurrent();
				bind(res.code, res.playerId);
			}
			reply(res);
			if (res.ok) {
				const lobby = manager.get(res.code);
				if (lobby) manager.publish(lobby);
			}
		};

		socket.on("lobby:create", (data, ack) => {
			try {
				enter(manager.create(data?.name), ack);
			} catch (e) {
				handle(ack, () => { throw e; });
			}
		});

		socket.on("lobby:join", (data, ack) => {
			try {
				const code = String(data?.code ?? "").trim();
				const isRejoin = typeof data?.playerId === "string" && typeof data?.token === "string";
				enter(isRejoin ? manager.rejoin(code, data.playerId, data.token) : manager.join(code, data?.name), ack);
			} catch (e) {
				handle(ack, () => { throw e; });
			}
		});

		socket.on("lobby:leave", () => {
			try {
				leaveCurrent();
			} catch (e) {
				console.error("leave error:", e);
			}
		});

		socket.on("lobby:settings", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.settings(code, id, data?.roundSeconds))));
		socket.on("game:start", (ack) => handle(ack, inLobby((code, id) => manager.start(code, id))));
		socket.on("theme:submit", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.submitTheme(code, id, data?.theme))));
		socket.on("guess:submit", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.guess(code, id, data?.word))));
		socket.on("bot:add", (data, ack) => handle(ack, inLobby((code, id) => manager.addBot(code, id, data?.difficulty))));
		socket.on("bot:difficulty", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.setBotDifficulty(code, id, data?.playerId, data?.difficulty))));
		socket.on("bot:remove", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.removeBot(code, id, data?.playerId))));
		socket.on("player:ready", (data, ack) =>
			handle(ack, inLobby((code, id) => manager.ready(code, id, data?.ready))));

		socket.on("disconnect", () => {
			try {
				const { code, playerId } = socket.data;
				const bound = playerId && sockets.get(playerId) === socket;
				unbind(socket);
				if (code && playerId && bound) manager.disconnect(code, playerId);
			} catch (e) {
				console.error("disconnect error:", e);
			}
		});
	});

	app.get("/healthz", (_req, res) => {
		res.json({ ok: true });
	});

	if (opts.serveClient ?? production) {
		const dist = opts.distDir ?? DEFAULT_DIST;
		app.use(express.static(dist));
		app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
	}

	return {
		app,
		httpServer,
		io,
		manager,
		listen(port = 0) {
			return new Promise((resolve, reject) => {
				httpServer.once("error", reject);
				httpServer.listen(port, () => {
					httpServer.off("error", reject);
					resolve((httpServer.address() as AddressInfo).port);
				});
			});
		},
		close() {
			manager.dispose();
			return new Promise((resolve) => {
				io.close(() => resolve());
			});
		},
	};
}
