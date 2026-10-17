<script lang="ts">
	import { onDestroy } from "svelte";
	import Header from "./components/Header.svelte";
	import Modal from "./components/Modal.svelte";
	import { Switch, Toaster } from "./components/widgets";
	import Home from "./components/screens/Home.svelte";
	import Lobby from "./components/screens/Lobby.svelte";
	import ThemePick from "./components/screens/ThemePick.svelte";
	import Generating from "./components/screens/Generating.svelte";
	import Playing from "./components/screens/Playing.svelte";
	import Results from "./components/screens/Results.svelte";
	import { leaveLobby, messages, session, snapshot, status } from "./socket";
	import { settings } from "./stores";
	import { unlock } from "./crowd";

	document.title = "Wordle+ Party | Themed multiplayer Wordle";

	let toaster: Toaster;
	let showSettings = false;

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

<!-- Browsers only allow sound after a gesture, so wake the crowd on the first one -->
<svelte:window on:pointerdown={unlock} on:keydown={unlock} />

<Toaster bind:this={toaster} />

<main>
	<Header
		inLobby={!!$snapshot}
		on:settings={() => (showSettings = true)}
		on:leave={leave}
	/>
	{#if $status !== "connected"}
		<div class="connection">
			{$status === "connecting" ? "Connecting…" : "Disconnected, reconnecting…"}
		</div>
	{/if}
	<div class="screen">
		{#if $snapshot}
			{#if $snapshot.phase === "LOBBY"}
				<Lobby />
			{:else if $snapshot.phase === "THEME_PICK"}
				<ThemePick />
			{:else if $snapshot.phase === "GENERATING"}
				<Generating />
			{:else if $snapshot.phase === "PLAYING"}
				{#key $snapshot.roundId}
					<Playing />
				{/key}
			{:else if $snapshot.phase === "RESULTS"}
				<Results />
			{/if}
		{:else if resuming}
			<div class="resuming">Rejoining game…</div>
		{:else}
			<Home />
		{/if}
	</div>
</main>

<Modal bind:visible={showSettings}>
	<h3>settings</h3>
	<div class="setting">
		<div class="title">Dark Theme</div>
		<Switch bind:value={$settings.dark} />
	</div>
	<div class="setting">
		<div>
			<div class="title">Color Blind Mode</div>
			<div class="desc">High contrast colors</div>
		</div>
		<Switch bind:value={$settings.colorblind} />
	</div>
	<div class="setting">
		<div>
			<div class="title">🏟️ Stadium Mode</div>
			<div class="desc">Crowd meters, commentary and confetti</div>
		</div>
		<Switch bind:value={$settings.stadium} />
	</div>
	<div class="setting">
		<div>
			<div class="title">Crowd Noise</div>
			<div class="desc">Roars, gasps and an air horn</div>
		</div>
		<Switch bind:value={$settings.crowdSound} disabled={!$settings.stadium} />
	</div>
</Modal>

<style lang="scss">
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		max-width: var(--game-width);
		margin: auto;
		position: relative;
	}
	.screen {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}
	.connection {
		width: 100%;
		text-align: center;
		font-size: var(--fs-small);
		font-weight: bold;
		padding: 4px;
		background: var(--red);
		color: #fff;
	}
	.resuming {
		margin: auto;
		color: var(--fg-secondary);
	}
	.setting {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 0;
		border-bottom: 1px solid var(--border-primary);
	}
	.title {
		font-size: var(--fs-medium);
		font-weight: 500;
	}
	.desc {
		font-size: var(--fs-tiny);
		color: var(--fg-secondary);
	}
</style>
