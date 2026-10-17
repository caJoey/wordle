<script context="module" lang="ts">
	import {
		modeData,
		seededRandomInt,
		Stats,
		GameState,
		Settings,
		LetterStates,
		getWordNumber,
		words,
	} from "./utils";
	import Game from "./components/Game.svelte";
	import { letterStates, settings, mode } from "./stores";
	import { GameMode } from "./enums";
	import { Toaster } from "./components/widgets";
	import { setContext } from "svelte";
	import MultiplayerLobby from "./components/multiplayer/MultiplayerLobby.svelte";

	document.title = "Wordle+ Party | Themed multiplayer Wordle";

	let toaster: Toaster;
	let multiplayerOpen = false;

	const unsub = messages.subscribe((m) => m && toaster?.pop(m.text, m.seconds));
	onDestroy(unsub);

	$: {
		const root = document.documentElement;
		root.classList.toggle("light", !$settings.dark);
		root.classList.toggle("colorblind", $settings.colorblind);
	}

	function leave() {
		if (confirm("Leave this game?")) leaveLobby();
	}

	// A session exists but its snapshot hasn't arrived yet (reloading or reconnecting)
	$: resuming = !!$session && !$snapshot;
</script>

<Toaster bind:this={toaster} />
<button class="multiplayer-launch" on:click={() => (multiplayerOpen = true)}>Multiplayer</button>
{#if multiplayerOpen}
	<MultiplayerLobby on:close={() => (multiplayerOpen = false)} />
{/if}
{#if toaster}
	<Game {stats} bind:word {toaster} bind:game={state} />
{/if}
