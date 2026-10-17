import { io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../../../shared/multiplayer";

// Set VITE_MULTIPLAYER_SERVER_URL when frontend and server are hosted separately.
const serverUrl = import.meta.env.VITE_MULTIPLAYER_SERVER_URL || "http://localhost:3001";
export const multiplayerSocket = io<ServerToClientEvents, ClientToServerEvents>(serverUrl, { autoConnect: false });
