import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

import type {
	ClientToServerEvents,
	RoundDuration,
	ServerToClientEvents,
} from "../../shared/multiplayer.js";
import {
	createLobby,
	findLobby,
	finishRound,
	joinLobby,
	randomAnswer,
	readyForNextRound,
	removePlayer,
	setTheme,
	snapshot,
	startRound,
	submitGuess,
} from "./game/manager.js";
import type { Lobby, Player } from "./game/types.js";
import { generateThemeWords } from "./theme/gemma.js";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
	cors: { origin: clientOrigin },
});

const playerLobby = new Map<string, string>();

app.use(cors({ origin: clientOrigin }));
app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

function broadcastLobby(lobby: Lobby): void {
	io.to(lobby.code).emit("game:state", snapshot(lobby));
}

function acknowledgeError(ack: Function, error: unknown): void {
	const message = error instanceof Error ? error.message : "Unexpected server error.";
	ack({ ok: false, error: message });
}

function createPlayer(socketId: string, name: string, isHost = false): Player {
	return {
		id: socketId,
		socketId,
		name: name.trim().slice(0, 24) || "Player",
		isHost,
		ready: false,
		status: "waiting",
		guesses: [],
		guessResults: [],
	};
}

io.on("connection", (socket) => {
	socket.on("lobby:create", ({ name, maxPlayers }, ack) => {
		try {
			if (![1, 2, 3, 4].includes(maxPlayers)) {
				throw new Error("Lobby size must be 1–4 players.");
			}

			const lobby = createLobby(createPlayer(socket.id, name, true), maxPlayers);
			playerLobby.set(socket.id, lobby.code);
			socket.join(lobby.code);
			broadcastLobby(lobby);
			ack({ ok: true, code: lobby.code });
		} catch (error) {
			acknowledgeError(ack, error);
		}
	});

	socket.on("lobby:join", ({ code, name }, ack) => {
		try {
			const lobby = findLobby(code.trim());
			if (!lobby) throw new Error("Lobby code not found.");

			joinLobby(lobby, createPlayer(socket.id, name));
			playerLobby.set(socket.id, lobby.code);
			socket.join(lobby.code);
			broadcastLobby(lobby);
			ack({ ok: true });
		} catch (error) {
			acknowledgeError(ack, error);
		}
	});

	socket.on("theme:set", ({ theme }, ack) => {
		try {
			const lobby = findLobby(playerLobby.get(socket.id) || "");
			const player = lobby?.players.find((candidate) => candidate.socketId === socket.id);
			if (!lobby || !player) throw new Error("Join a lobby first.");

			setTheme(lobby, player, theme);
			broadcastLobby(lobby);
			ack({ ok: true });
		} catch (error) {
			acknowledgeError(ack, error);
		}
	});

	socket.on("round:start", async ({ durationMinutes }, ack) => {
		try {
			const lobby = findLobby(playerLobby.get(socket.id) || "");
			if (!lobby || lobby.players[0]?.socketId !== socket.id) {
				throw new Error("Only the host can start a round.");
			}
			if (![5, 10, null].includes(durationMinutes)) {
				throw new Error("Duration must be 5, 10, or unlimited minutes.");
			}
			if (!lobby.theme) throw new Error("The theme picker must set a theme first.");

			const words = await generateThemeWords(lobby.theme);
			const answer = randomAnswer(words);
			startRound(lobby, answer, durationMinutes as RoundDuration);

			if (lobby.endsAt) {
				lobby.timer = setTimeout(() => {
					finishRound(lobby);
					broadcastLobby(lobby);
				}, lobby.endsAt - Date.now());
			}

			broadcastLobby(lobby);
			ack({ ok: true });
		} catch (error) {
			acknowledgeError(ack, error);
		}
	});

	socket.on("guess:submit", ({ guess }, ack) => {
		try {
			const lobby = findLobby(playerLobby.get(socket.id) || "");
			const player = lobby?.players.find((candidate) => candidate.socketId === socket.id);
			if (!lobby || !player) throw new Error("Join a lobby before guessing.");

			submitGuess(lobby, player, guess);
			broadcastLobby(lobby);
			ack({ ok: true });
		} catch (error) {
			acknowledgeError(ack, error);
		}
	});

	socket.on("player:ready", ({ ready }) => {
		const lobby = findLobby(playerLobby.get(socket.id) || "");
		const player = lobby?.players.find((candidate) => candidate.socketId === socket.id);
		if (!lobby || !player) return;

		readyForNextRound(lobby, player, ready);
		broadcastLobby(lobby);
	});

	function leaveLobby(): void {
		const code = playerLobby.get(socket.id);
		if (!code) return;

		const lobby = findLobby(code);
		playerLobby.delete(socket.id);
		socket.leave(code);

		if (!lobby) return;
		removePlayer(lobby, socket.id);
		if (lobby.players.length > 0) broadcastLobby(lobby);
	}

	socket.on("lobby:leave", leaveLobby);
	socket.on("disconnect", leaveLobby);
});

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => {
	console.log(`Multiplayer server listening on http://localhost:${port}`);
});
