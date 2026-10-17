<script lang="ts">
	import { MAX_PLAYERS } from "../../../shared/protocol";
	import { me, setRoundSeconds, snapshot, startGame, toast } from "../../socket";
	import { copyText, formatClock } from "../../utils";
	import { PlayerList } from "../widgets";

	const MIN_SECONDS = 60;
	const MAX_SECONDS = 600;

	let seconds = $snapshot.roundSeconds;
	let dragging = false;
	let starting = false;

	// Follow the server's value unless the host is mid-drag
	$: if (!dragging) seconds = $snapshot.roundSeconds;
	$: isHost = !!$me?.isHost;
	$: host = $snapshot.players.find((p) => p.isHost);

	async function copyLink() {
		const url = `${location.origin}${location.pathname}?code=${$snapshot.code}`;
		toast((await copyText(url)) ? "Invite link copied" : "Could not copy link");
	}

	async function changeSeconds() {
		dragging = false;
		const res = await setRoundSeconds(seconds);
		if ("error" in res) {
			toast(res.error, 3);
			seconds = $snapshot.roundSeconds;
		}
	}

	async function start() {
		starting = true;
		const res = await startGame();
		starting = false;
		if ("error" in res) toast(res.error, 3);
	}
</script>

<div class="lobby">
	<section class="code-box">
		<div class="label">Game code</div>
		<div class="code">{$snapshot.code}</div>
		<button class="copy" on:click={copyLink}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
				/>
			</svg>
			Copy invite link
		</button>
	</section>

	<section>
		<div class="label">Players {$snapshot.players.length}/{MAX_PLAYERS}</div>
		<PlayerList players={$snapshot.players} youId={$snapshot.youId} />
	</section>

	<section>
		<div class="label">Round length</div>
		{#if isHost}
			<div class="slider">
				<input
					type="range"
					min={MIN_SECONDS}
					max={MAX_SECONDS}
					step={30}
					bind:value={seconds}
					on:input={() => (dragging = true)}
					on:change={changeSeconds}
					aria-label="Round length in seconds"
				/>
				<span>{formatClock(seconds)}</span>
			</div>
		{:else}
			<div class="value">{formatClock($snapshot.roundSeconds)}</div>
		{/if}
	</section>

	<div class="footer">
		{#if isHost}
			<button class="button" disabled={starting} on:click={start}>Start game</button>
		{:else}
			<div class="waiting">
				Waiting for {host?.name ?? "the host"} to start<span class="dots"
					><span>.</span><span>.</span><span>.</span></span
				>
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	.lobby {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		flex: 1;
	}
	.code-box {
		text-align: center;
	}
	.code {
		font-size: 3.2rem;
		font-weight: bold;
		letter-spacing: 0.3em;
		margin-right: -0.3em;
		font-variant-numeric: tabular-nums;
		user-select: text;
		-webkit-user-select: text;
	}
	.copy {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		padding: 6px 12px;
		border: 1px solid var(--border-primary);
		border-radius: 20px;
		background: none;
		color: var(--fg-primary);
		font: inherit;
		font-size: var(--fs-small);
		cursor: pointer;
		svg {
			width: 16px;
			fill: currentColor;
		}
	}
	.slider {
		display: flex;
		align-items: center;
		gap: 12px;
		input {
			flex: 1;
			accent-color: var(--color-correct);
		}
		span {
			font-weight: bold;
			min-width: 3em;
			text-align: right;
		}
	}
	.value {
		font-weight: bold;
		font-size: var(--fs-medium);
	}
	.footer {
		margin-top: auto;
		.button {
			margin-top: 0;
		}
	}
	.waiting {
		text-align: center;
		color: var(--fg-secondary);
		padding: 15px;
	}
	.dots span {
		animation: dot-pulse 1.4s infinite;
		&:nth-child(2) {
			animation-delay: 0.2s;
		}
		&:nth-child(3) {
			animation-delay: 0.4s;
		}
	}
</style>
