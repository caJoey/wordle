import { io, type Socket } from "socket.io-client";
import { derived, get, writable } from "svelte/store";
import type {
	Ack,
	ClientToServerEvents,
	LetterState,
	LobbySnapshot,
	PlayerView,
	ServerToClientEvents,
	Session,
} from "../shared/protocol";
import { playerName } from "./stores";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

const SESSION_KEY = "session";
const ACK_TIMEOUT = 10_000;

/** The latest snapshot from the server, or null when not in a lobby. */
export const snapshot = writable<LobbySnapshot | null>(null);
export const status = writable<ConnectionStatus>("connecting");
export const session = writable<Session | null>(loadSession());
/** serverClock - localClock in ms, measured from the latest snapshot. */
export const clockOffset = writable(0);
/** Messages for the UI to show as toasts (errors, notices, lobby closed). */
export const messages = writable<{ id: number, text: string, seconds: number; } | null>(null);

/** The receiving player's own entry in the latest snapshot. */
export const me = derived(snapshot, (s): PlayerView | undefined => s?.players.find((p) => p.id === s.youId));

session.subscribe((s) => {
	try {
		if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
		else sessionStorage.removeItem(SESSION_KEY);
	} catch { /* storage unavailable */ }
});

function loadSession(): Session | null {
	try {
		const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
		return s && s.code && s.playerId && s.token ? s : null;
	} catch {
		return null;
	}
}

let messageId = 0;
export function toast(text: string, seconds = 2) {
	messages.set({ id: ++messageId, text, seconds });
}

// Same origin by default: the Vite dev server proxies /socket.io to the game server
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = import.meta.env.VITE_SERVER_URL
	? io(import.meta.env.VITE_SERVER_URL)
	: io();

/** False after leaving a lobby, so late snapshots don't pull the player back in. */
let active = !!get(session);

socket.on("connect", () => {
	status.set("connected");
	resume();
});
socket.on("disconnect", () => status.set("disconnected"));
socket.on("connect_error", () => status.set("disconnected"));
socket.io.on("reconnect_attempt", () => status.set("connecting"));

let lastNotice: string | undefined;
socket.on("lobby:snapshot", (s) => {
	if (!active) return;
	clockOffset.set(s.serverNow - Date.now());
	if (s.notice && s.notice !== lastNotice) toast(s.notice, 3);
	lastNotice = s.notice;
	snapshot.set(s);
});

socket.on("lobby:closed", ({ reason }) => {
	reset();
	toast(reason || "The game has ended", 3);
});

function reset() {
	active = false;
	session.set(null);
	snapshot.set(null);
	lastNotice = undefined;
}

/** Emit an event that expects an ack, turning timeouts and disconnects into an error result. */
async function call<T>(send: (s: ReturnType<typeof socket.timeout>) => Promise<Ack<T>>): Promise<Ack<T>> {
	try {
		return await send(socket.timeout(ACK_TIMEOUT));
	} catch {
		return { ok: false, error: "The server did not respond" };
	}
}

/** Rejoin the lobby saved in this tab's session, e.g. after a reload or a dropped connection. */
async function resume() {
	const s = get(session);
	if (!s) return;
	active = true;
	const res = await call((sock) => sock.emitWithAck("lobby:join", {
		code: s.code,
		name: get(playerName),
		playerId: s.playerId,
		token: s.token,
	}));
	if (!("error" in res)) {
		const { ok, ...next } = res;
		session.set(next);
		return;
	}
	if (res.error === "Session expired") {
		// Our seat is gone but the lobby may still exist: join it again as a new player
		const again = await joinLobby(s.code, get(playerName));
		if (!("error" in again)) return;
	}
	reset();
	toast(res.error, 3);
}

function start(res: Ack<Session>) {
	if (res.ok) {
		const { ok, ...s } = res;
		session.set(s);
	} else {
		reset();
	}
	return res;
}

export async function createLobby(name: string) {
	active = true;
	return start(await call((s) => s.emitWithAck("lobby:create", { name })));
}

export async function joinLobby(code: string, name: string) {
	active = true;
	return start(await call((s) => s.emitWithAck("lobby:join", { code, name })));
}

/** The server neither acks nor sends lobby:closed for a voluntary leave, so reset right away. */
export function leaveLobby() {
	socket.emit("lobby:leave");
	reset();
}

export function setRoundSeconds(roundSeconds: number) {
	return call((s) => s.emitWithAck("lobby:settings", { roundSeconds }));
}

export function startGame() {
	return call((s) => s.emitWithAck("game:start"));
}

export function submitTheme(theme: string) {
	return call((s) => s.emitWithAck("theme:submit", { theme }));
}

export function submitGuess(word: string) {
	return call<{ colors: LetterState[]; }>((s) => s.emitWithAck("guess:submit", { word }));
}

export function setReady(ready: boolean) {
	return call((s) => s.emitWithAck("player:ready", { ready }));
}
