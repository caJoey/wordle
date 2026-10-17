<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { BOT_DIFFICULTIES, type BotDifficulty, type PlayerView } from "../../../shared/protocol";
	import Avatar from "./Avatar.svelte";

	export let players: PlayerView[];
	export let youId: string;
	/** Show each player's ready state. */
	export let showReady = false;
	/** Show difficulty pickers and remove buttons on bots (host only). */
	export let canRemoveBots = false;

	const dispatch = createEventDispatcher<{
		removeBot: string;
		botDifficulty: { playerId: string; difficulty: BotDifficulty };
	}>();

	function pickDifficulty(playerId: string, e: Event) {
		dispatch("botDifficulty", { playerId, difficulty: (e.currentTarget as HTMLSelectElement).value as BotDifficulty });
	}
</script>

<ul class="players">
	{#each players as p, i (p.id)}
		<li class:offline={!p.connected}>
			<Avatar name={p.name} index={i} dim={!p.connected} bot={p.bot} />
			<div class="name">
				{p.name}
				{#if p.id === youId}<span class="you">(you)</span>{/if}
			</div>
			<div class="badges">
				{#if p.isHost}<span class="badge host">host</span>{/if}
				{#if p.bot}
					{#if canRemoveBots}
						<select
							class="difficulty"
							value={p.botDifficulty}
							on:change={(e) => pickDifficulty(p.id, e)}
							aria-label="{p.name} difficulty"
						>
							{#each BOT_DIFFICULTIES as d}<option value={d}>{d}</option>{/each}
						</select>
					{:else}
						<span class="badge bot">bot · {p.botDifficulty}</span>
					{/if}
				{/if}
				{#if !p.connected}<span class="badge">offline</span>{/if}
				{#if p.spectating}<span class="badge">next round</span>{/if}
				{#if p.wins > 0}<span class="wins" title="Round wins">🏆 {p.wins}</span>{/if}
				{#if showReady}
					<span class="ready" class:on={p.ready}>{p.ready ? "Ready" : "Not ready"}</span>
				{/if}
				{#if canRemoveBots && p.bot}
					<button class="remove" title="Remove {p.name}" on:click={() => dispatch("removeBot", p.id)}>✕</button>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<style lang="scss">
	.players {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--bg-secondary);
		&.offline .name {
			color: var(--fg-secondary);
		}
	}
	.name {
		flex: 1;
		min-width: 0;
		font-weight: bold;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.you {
		font-weight: normal;
		color: var(--fg-secondary);
		font-size: var(--fs-small);
	}
	.badges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		font-size: var(--fs-tiny);
	}
	.badge {
		text-transform: uppercase;
		font-weight: bold;
		padding: 2px 6px;
		border-radius: 3px;
		background: var(--border-primary);
		color: var(--fg-primary);
		&.host {
			background: var(--color-present);
			color: #fff;
		}
		&.bot {
			background: #4a7fc1;
			color: #fff;
		}
	}
	.difficulty {
		min-width: 0;
		padding: 2px 4px;
		font-size: var(--fs-tiny);
		font-weight: bold;
		text-transform: uppercase;
		border-radius: 3px;
		border: none;
		background: #4a7fc1;
		color: #fff;
		cursor: pointer;
	}
	.remove {
		border: none;
		background: none;
		color: var(--fg-secondary);
		font-size: var(--fs-small);
		cursor: pointer;
		padding: 2px 4px;
		&:hover {
			color: var(--red);
		}
	}
	.wins {
		font-weight: bold;
	}
	.ready {
		font-weight: bold;
		text-transform: uppercase;
		color: var(--fg-secondary);
		&.on {
			color: var(--color-correct);
		}
	}
</style>
