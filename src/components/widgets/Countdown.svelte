<script lang="ts">
	import { clockOffset } from "../../socket";
	import { now } from "../../stores";
	import { formatClock } from "../../utils";

	/** Server epoch ms when the countdown ends. */
	export let endsAt: number | undefined;
	/** Length of the whole period in seconds, to draw the bar. Omit for text only. */
	export let total: number = undefined;

	$: remaining = endsAt ? Math.max(0, (endsAt - ($now + $clockOffset)) / 1000) : 0;
	$: fraction = total ? Math.min(1, remaining / total) : 0;
	$: urgent = !!endsAt && remaining <= 10;
</script>

{#if endsAt}
	<div class="countdown" class:urgent class:bar={!!total}>
		{#if total}
			<div class="track"><div class="fill" style="width: {fraction * 100}%" /></div>
		{/if}
		<span class="time">{formatClock(remaining)}</span>
	</div>
{/if}

<style lang="scss">
	.countdown {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-weight: bold;
		font-variant-numeric: tabular-nums;
		&.bar {
			width: 100%;
		}
	}
	.track {
		flex: 1;
		height: 8px;
		border-radius: 4px;
		background: var(--border-primary);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--color-correct);
		transition: width 0.25s linear, background-color 0.3s ease;
	}
	.urgent {
		color: var(--red);
		.fill {
			background: var(--red);
		}
		.time {
			animation: pulse 1s infinite;
		}
	}
	.time {
		min-width: 3.2em;
		text-align: center;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}
</style>
