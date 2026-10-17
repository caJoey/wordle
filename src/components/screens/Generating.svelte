<script lang="ts">
	import { snapshot } from "../../socket";

	$: picker = $snapshot.players.find((p) => p.id === $snapshot.pickerId);
</script>

<div class="generating">
	<div class="tiles" aria-hidden="true">
		{#each Array(5) as _, i}
			<div class="tile" style="--i: {i}">?</div>
		{/each}
	</div>
	<h2>Finding words for</h2>
	<div class="theme">{$snapshot.theme ?? "your theme"}…</div>
	{#if picker}
		<p>Theme by {picker.name}</p>
	{/if}
</div>

<style lang="scss">
	.generating {
		margin: auto;
		padding: 24px 16px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.tiles {
		display: flex;
		gap: 6px;
		margin-bottom: 20px;
	}
	.tile {
		width: 52px;
		height: 52px;
		display: grid;
		place-items: center;
		font-size: 1.8rem;
		font-weight: bold;
		border: 2px solid var(--border-primary);
		animation: cycle 2.4s ease-in-out calc(var(--i) * 0.18s) infinite;
	}
	@keyframes cycle {
		0%,
		100% {
			transform: rotateX(0deg);
			background: transparent;
			border-color: var(--border-primary);
		}
		25% {
			transform: rotateX(90deg);
		}
		30%,
		60% {
			transform: rotateX(0deg);
			background: var(--color-present);
			border-color: var(--color-present);
			color: #fff;
		}
		75% {
			background: var(--color-correct);
			border-color: var(--color-correct);
			color: #fff;
		}
	}
	h2 {
		font-size: var(--fs-medium);
		color: var(--fg-secondary);
		font-weight: normal;
	}
	.theme {
		font-size: 2rem;
		font-weight: bold;
		word-break: break-word;
	}
	p {
		color: var(--fg-secondary);
		font-size: var(--fs-small);
	}
</style>
