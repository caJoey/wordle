<script lang="ts">
	import { levelFor } from "../../stadium";

	/** 0..100 */
	export let hype: number;
	/** The player's seat color. */
	export let color = "#538d4e";
	export let name = "";
	/** A thin bar with no labels, for opponent cards. */
	export let compact = false;

	const SEGMENTS = 20;
	/** Cool to hot, sampled along the bar like a broadcast crowd meter. */
	const HEAT = ["#23c4ff", "#2ee6a6", "#c6f432", "#ffd23f", "#ff8a1a", "#ff3b3b", "#ff2d8a"];

	$: count = compact ? 12 : SEGMENTS;
	$: lit = Math.round((hype / 100) * count);
	$: level = levelFor(hype);
	$: tier = level.tier;

	function heat(i: number) {
		return HEAT[Math.min(HEAT.length - 1, Math.floor((i / count) * HEAT.length))];
	}
</script>

<div class="meter tier-{tier}" class:compact style="--team: {color}" title="Crowd: {hype}">
	{#if !compact}
		<div class="tag">
			<span class="kicker">Stadium Pulse</span>
			<span class="who">{name}</span>
		</div>
	{/if}
	<div class="bar">
		{#each Array(count) as _, i}
			<div class="seg" class:on={i < lit} style="--heat: {heat(i)}; --i: {i}" />
		{/each}
		{#if tier >= 4}<div class="sweep" />{/if}
	</div>
	{#if !compact}
		<div class="level">
			{#if tier === 5}<span class="max">MAX</span>{/if}
			{level.label}
		</div>
	{/if}
</div>

<style lang="scss">
	.meter {
		--h: 30px;
		display: flex;
		align-items: stretch;
		width: 100%;
		height: var(--h);
		font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif;
		font-style: italic;
		font-weight: 800;
		text-transform: uppercase;
		color: #fff;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
		&.compact {
			--h: 6px;
			filter: none;
		}
	}
	.tag,
	.level,
	.bar {
		transform: skewX(-14deg);
	}
	.tag {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0 10px 0 12px;
		margin-left: 6px;
		background: linear-gradient(135deg, var(--team), color-mix(in srgb, var(--team) 55%, #000));
		border-left: 4px solid #fff;
		line-height: 1;
		max-width: 34%;
		> * {
			transform: skewX(14deg);
		}
	}
	.kicker {
		font-size: 9px;
		letter-spacing: 1.5px;
		opacity: 0.85;
	}
	.who {
		font-size: 15px;
		letter-spacing: 0.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar {
		position: relative;
		flex: 1;
		display: flex;
		gap: 2px;
		padding: 4px 6px;
		background: linear-gradient(180deg, #1b2233, #0b0f19);
		border-top: 1px solid rgba(255, 255, 255, 0.15);
		overflow: hidden;
		.compact & {
			padding: 0;
			gap: 1px;
			border: none;
			background: rgba(0, 0, 0, 0.35);
			border-radius: 1px;
		}
	}
	.seg {
		flex: 1;
		background: rgba(255, 255, 255, 0.07);
		transition: background-color 0.25s ease, box-shadow 0.25s ease;
		transition-delay: calc(var(--i) * 15ms);
		&.on {
			background: var(--heat);
			box-shadow: 0 0 6px var(--heat);
		}
	}
	/* A light sweeping across the bar once the crowd is really going */
	.sweep {
		position: absolute;
		inset: 0;
		background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.55) 50%, transparent 70%);
		background-size: 250% 100%;
		animation: sweep 1.4s linear infinite;
		pointer-events: none;
	}
	.level {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 12px 0 10px;
		margin-right: 6px;
		font-size: 14px;
		letter-spacing: 0.5px;
		white-space: nowrap;
		background: #0b0f19;
		border-right: 4px solid var(--level, #555);
		color: var(--level, #aaa);
		transition: color 0.3s ease, border-color 0.3s ease;
	}
	.max {
		background: #fff;
		color: #ff2d55;
		padding: 1px 4px;
		font-size: 11px;
		animation: blink 0.5s steps(2) infinite;
	}
	.tier-0 { --level: #6b7280; }
	.tier-1 { --level: #9ca3af; }
	.tier-2 { --level: #23c4ff; }
	.tier-3 { --level: #ffd23f; }
	.tier-4 { --level: #ff8a1a; }
	.tier-5 {
		--level: #ff2d55;
		&:not(.compact) {
			animation: rumble 0.35s linear infinite;
		}
		.bar {
			box-shadow: 0 0 14px rgba(255, 45, 85, 0.7);
		}
	}
	@keyframes sweep {
		from { background-position: 150% 0; }
		to { background-position: -100% 0; }
	}
	@keyframes blink {
		50% { opacity: 0.2; }
	}
	@keyframes rumble {
		0%, 100% { transform: translate(0, 0); }
		25% { transform: translate(-1px, 1px); }
		50% { transform: translate(1px, 0); }
		75% { transform: translate(0, -1px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.sweep,
		.max,
		.meter {
			animation: none !important;
		}
	}
</style>
