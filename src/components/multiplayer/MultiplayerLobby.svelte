<script lang="ts">
	import { createEventDispatcher, onDestroy } from "svelte";

	import type { GameSnapshot, RoundDuration } from "../../../shared/multiplayer";
	import GuessInput from "./GuessInput.svelte";
	import { multiplayerSocket } from "../../lib/multiplayer/socket";

	const dispatch = createEventDispatcher();

	let name = localStorage.getItem("multiplayer-name") || "Player";
	let code = "";
	let lobbyCode = "";
	let theme = "";
	let maxPlayers = 4;
	let duration: RoundDuration = 5;
	let state: GameSnapshot | null = null;
	let error = "";
	let secondsNow = Date.now();

	const clock = setInterval(() => {
		secondsNow = Date.now();
	}, 1000);

	function showError(message: string): void {
		error = message;
	}

	function handleGameState(nextState: GameSnapshot): void {
		state = nextState;
		lobbyCode = nextState.code;
	}

	function connectThen(action: () => void): void {
		name = name.trim().slice(0, 24) || "Player";
		localStorage.setItem("multiplayer-name", name);

		if (multiplayerSocket.connected) {
			action();
			return;
		}

		multiplayerSocket.connect();
		multiplayerSocket.once("connect", action);
		multiplayerSocket.once("connect_error", () => {
			showError("Could not connect to the multiplayer server.");
		});
	}

	function createLobby(): void {
		error = "";
		connectThen(() => {
			multiplayerSocket.emit("lobby:create", { name, maxPlayers }, (result) => {
				if (!result.ok) {
					showError(result.error);
				} else {
					lobbyCode = result.code;
				}
			});
		});
	}

	function joinLobby(): void {
		error = "";
		connectThen(() => {
			multiplayerSocket.emit("lobby:join", { code: code.trim(), name }, (result) => {
				if (!result.ok) showError(result.error);
			});
		});
	}

	function setTheme(): void {
		multiplayerSocket.emit("theme:set", { theme: theme.trim() }, (result) => {
			if (!result.ok) showError(result.error);
		});
	}

	function startRound(): void {
		multiplayerSocket.emit("round:start", { durationMinutes: duration }, (result) => {
			if (!result.ok) showError(result.error);
		});
	}

	function submitGuess(guess: string): void {
		multiplayerSocket.emit("guess:submit", { guess }, (result) => {
			if (!result.ok) showError(result.error);
		});
	}

	function setReady(ready: boolean): void {
		multiplayerSocket.emit("player:ready", { ready });
	}

	$: currentPlayer = state?.players.find((player) => player.id === multiplayerSocket.id);
	$: remainingSeconds = state?.endsAt
		? Math.max(0, Math.ceil((state.endsAt - secondsNow) / 1000))
		: null;

	multiplayerSocket.on("game:state", handleGameState);
	multiplayerSocket.on("game:error", showError);

	onDestroy(() => {
		clearInterval(clock);
		multiplayerSocket.off("game:state", handleGameState);
		multiplayerSocket.off("game:error", showError);
		multiplayerSocket.emit("lobby:leave");
		multiplayerSocket.disconnect();
	});
</script>

<section class="overlay" aria-label="Multiplayer game">
	<div class="panel">
		<button class="close" on:click={() => dispatch("close")} aria-label="Close">×</button>
		<h1>Multiplayer Wordle</h1>

		{#if !state}
			<label>
				Player name
				<input bind:value={name} maxlength="24" />
			</label>

			<div class="actions">
				<div class="card">
					<h2>Host a lobby</h2>
					<label>
						Players
						<select bind:value={maxPlayers}>
							<option value={1}>1 player</option>
							<option value={2}>2 players</option>
							<option value={3}>3 players</option>
							<option value={4}>4 players</option>
						</select>
					</label>
					<button on:click={createLobby}>Create lobby</button>
				</div>

				<div class="card">
					<h2>Join a lobby</h2>
					<label>
						6 digit code
						<input bind:value={code} inputmode="numeric" maxlength="6" />
					</label>
					<button on:click={joinLobby}>Join game</button>
				</div>
			</div>
		{:else}
			<p class="code-label">Lobby code</p>
			<p class="code">{lobbyCode}</p>
			<p>{state.players.length} / {state.maxPlayers} players · {state.phase}</p>

			<ul>
				{#each state.players as player (player.id)}
					<li>{player.name}{player.isHost ? " (host)" : ""} — {player.status}</li>
				{/each}
			</ul>

			{#if state.phase === "lobby"}
				{#if currentPlayer?.id === state.themePickerId}
					<label>
						Round theme
						<input bind:value={theme} placeholder="e.g. ocean animals" />
					</label>
					<button on:click={setTheme}>Set theme</button>
				{:else}
					<p>
						Waiting for {state.players.find((player) => player.id === state.themePickerId)?.name ||
							"the theme picker"} to choose a theme.
					</p>
				{/if}

				<label>
					Round duration
					<select bind:value={duration}>
						<option value={5}>5 minutes</option>
						<option value={10}>10 minutes</option>
						<option value={null}>Unlimited</option>
					</select>
				</label>

				{#if currentPlayer?.isHost}
					<button disabled={!state.theme} on:click={startRound}>Start round</button>
				{/if}
			{:else if state.phase === "playing"}
				<p>
					Theme: <strong>{state.theme}</strong>
					{#if remainingSeconds !== null} · {remainingSeconds}s remaining{/if}
				</p>

				{#if currentPlayer?.status === "playing"}
					<GuessInput on:guess={(event) => submitGuess(event.detail)} />
				{/if}

				<div class="players">
					{#each state.players as player}
						<article>
							<strong>{player.name}</strong>
							<span>{player.status} · {player.guesses.length}/6 guesses</span>
							{#each player.guesses as guess, index}
								<div class="guess">
									{guess} <small>{player.guessResults[index]?.join("")}</small>
								</div>
							{/each}
						</article>
					{/each}
				</div>
			{:else}
				<p>Answer: <strong>{state.answer}</strong></p>
				<p>
					{state.winnerId
						? `Winner: ${state.players.find((player) => player.id === state.winnerId)?.name || "Player"}`
						: "No one solved in time."}
				</p>

				{#if currentPlayer}
					<button on:click={() => setReady(!currentPlayer.ready)}>
						{currentPlayer.ready ? "Ready ✓" : "Ready for next round"}
					</button>
				{/if}
			{/if}
		{/if}

		{#if error}<p class="error">{error}</p>{/if}
	</div>
</section>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 20;
		background: #000b;
		display: grid;
		place-items: center;
		padding: 16px;
	}

	.panel {
		position: relative;
		width: min(680px, 96vw);
		max-height: 92vh;
		overflow: auto;
		background: var(--bg-primary);
		color: var(--fg-primary);
		border: 1px solid var(--border-primary);
		border-radius: 12px;
		padding: 24px;
	}

	.close {
		float: right;
		background: transparent;
		color: inherit;
		border: 0;
		font-size: 28px;
		cursor: pointer;
	}

	.panel h1 {
		text-align: center;
		margin: 8px 0 24px;
	}

	.panel h2 {
		margin-bottom: 12px;
	}

	.panel label {
		display: grid;
		gap: 6px;
		margin: 12px 0;
		color: var(--fg-secondary);
	}

	.panel input,
	.panel select {
		font: inherit;
		padding: 10px;
		color: var(--fg-primary);
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}

	.card,
	.players article {
		padding: 14px;
		border: 1px solid var(--border-primary);
		border-radius: 8px;
		margin: 8px 0;
	}

	.panel button:not(.close) {
		border: 0;
		border-radius: 4px;
		padding: 10px 14px;
		background: var(--color-correct);
		color: white;
		font-weight: bold;
		cursor: pointer;
	}

	.panel button:disabled {
		opacity: 0.5;
	}

	.code-label {
		text-align: center;
	}

	.code {
		font-size: 32px;
		letter-spacing: 0.25em;
		text-align: center;
		font-weight: bold;
		margin: 8px;
	}

	.players {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 8px;
	}

	.players article {
		display: grid;
		gap: 5px;
	}

	.players span,
	.guess small {
		color: var(--fg-secondary);
	}

	.error {
		color: #ff7373;
		margin-top: 12px;
	}

	.guess {
		font-family: monospace;
	}

	@media (max-width: 560px) {
		.actions {
			grid-template-columns: 1fr;
		}
	}
</style>
