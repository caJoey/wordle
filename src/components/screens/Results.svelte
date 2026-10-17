<script lang="ts">
	import type { PlayerView, RankEntry } from "../../../shared/protocol";
	import { me, setReady, snapshot, toast } from "../../socket";
	import { formatSeconds, ordinal, ROWS } from "../../utils";
	import { MiniBoard } from "../board";
	import { Avatar } from "../widgets";

	type Row = RankEntry & { player: PlayerView; index: number; };

	/** Boards shown before "show all"; with 50 players the full grid is a long scroll. */
	const BOARDS_SHOWN = 12;
	let sending = false;
	let allBoards = false;

	$: results = $snapshot.results;
	$: answer = results?.answer ?? "";
	$: rows = (results?.ranking ?? [])
		.map((r) => {
			const index = $snapshot.players.findIndex((p) => p.id === r.playerId);
			return { ...r, player: $snapshot.players[index], index };
		})
		.filter((r): r is Row => !!r.player);
	// Podium order: 2nd, 1st, 3rd
	$: podium = [rows[1], rows[0], rows[2]].filter(Boolean);
	// Bots are always ready, so only humans count toward the next round
	$: active = $snapshot.players.filter((p) => p.connected && !p.spectating && !p.bot);
	$: waitingOn = active.filter((p) => !p.ready);
	$: readyCount = active.filter((p) => p.ready).length;

	function outcome(r: RankEntry) {
		if (!r.solved) return "Not solved";
		return `${r.guesses}/${ROWS}${r.solveMs != undefined ? ` · ${formatSeconds(r.solveMs)}` : ""}`;
	}

	async function toggleReady() {
		sending = true;
		const res = await setReady(!$me?.ready);
		sending = false;
		if ("error" in res) toast(res.error, 3);
	}
</script>

<div class="results">
	<section class="reveal">
		<div class="label">The word was</div>
		<div class="answer">
			{#each answer as letter, i}
				<div class="tile" style="--i: {i}">{letter}</div>
			{/each}
		</div>
		{#if results?.theme}
			<div class="theme">Theme: <b>{results.theme}</b></div>
		{/if}
	</section>

	{#if podium.length}
		<section class="podium">
			{#each podium as r (r.playerId)}
				<div class="step place-{Math.min(r.place, 3)}" class:unsolved={!r.solved}>
					<Avatar name={r.player.name} index={r.index} size={r.place === 1 ? 44 : 34} bot={r.player.bot} />
					<div class="pname">{r.player.name}</div>
					<div class="block">
						<div class="pos">{r.place === 1 && r.solved ? "👑" : ordinal(r.place)}</div>
						<div class="detail">{outcome(r)}</div>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<section>
		<ol class="ranking">
			{#each rows as r (r.playerId)}
				<li class:you={r.playerId === $snapshot.youId}>
					<span class="place">{ordinal(r.place)}</span>
					<Avatar name={r.player.name} index={r.index} size={24} dim={!r.player.connected} bot={r.player.bot} />
					<span class="name">{r.player.name}</span>
					<span class="outcome" class:solved={r.solved}>{outcome(r)}</span>
					<span class="wins" title="Round wins">🏆 {r.player.wins}</span>
				</li>
			{/each}
		</ol>
	</section>

	<section class="boards">
		{#each allBoards ? rows : rows.slice(0, BOARDS_SHOWN) as r (r.playerId)}
			<div class="board">
				<div class="bname">{r.player.name}</div>
				<MiniBoard colors={r.player.colors} words={r.player.words ?? []} size={22} />
			</div>
		{/each}
		{#if !allBoards && rows.length > BOARDS_SHOWN}
			<button class="more" on:click={() => (allBoards = true)}>Show all {rows.length} boards</button>
		{/if}
	</section>

	<section class="ready">
		<div class="who">
			{#each $snapshot.players as p, i (p.id)}
				{#if !p.spectating && !p.bot && (active.length <= 12 || waitingOn.includes(p))}
					<div class="chip" class:on={p.ready} class:offline={!p.connected}>
						<Avatar name={p.name} index={i} size={20} dim={!p.connected} />
						{p.name}
						<span>{p.ready ? "✓" : "…"}</span>
					</div>
				{/if}
			{/each}
		</div>
		{#if $me?.spectating}
			<div class="spectating">You'll play from the next round</div>
		{:else}
			<button
				class="button"
				class:secondary={$me?.ready}
				disabled={sending}
				on:click={toggleReady}
			>
				{$me?.ready ? "Not ready" : "Ready for next round"}
			</button>
		{/if}
		<div class="count">{readyCount}/{active.length} ready</div>
	</section>
</div>

<style lang="scss">
	.results {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.reveal {
		text-align: center;
	}
	.answer {
		display: flex;
		justify-content: center;
		gap: 6px;
		margin: 4px 0 8px;
	}
	.tile {
		width: 56px;
		height: 56px;
		display: grid;
		place-items: center;
		font-size: 2rem;
		font-weight: bold;
		text-transform: uppercase;
		color: #fff;
		background: var(--color-correct);
		animation: flip 0.5s ease calc(var(--i) * 0.2s) backwards;
	}
	@keyframes flip {
		from {
			transform: rotateX(90deg);
			background: var(--border-primary);
		}
	}
	.theme {
		color: var(--fg-secondary);
		b {
			color: var(--fg-primary);
		}
	}
	.podium {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: 8px;
	}
	.step {
		flex: 1;
		max-width: 120px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		animation: rise 0.6s ease backwards;
		&.place-1 {
			animation-delay: 1.4s;
			.block {
				height: 110px;
				background: var(--color-correct);
			}
		}
		&.place-2 {
			animation-delay: 1s;
			.block {
				height: 80px;
				background: var(--color-present);
			}
		}
		&.place-3 {
			animation-delay: 0.6s;
			.block {
				height: 56px;
			}
		}
		&.unsolved .block {
			background: var(--border-primary);
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(40px);
		}
	}
	.pname {
		font-weight: bold;
		font-size: var(--fs-small);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.block {
		width: 100%;
		border-radius: 6px 6px 0 0;
		background: var(--key-bg);
		color: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding-top: 8px;
		gap: 2px;
	}
	.pos {
		font-size: 1.6rem;
		font-weight: bold;
	}
	.detail {
		font-size: var(--fs-tiny);
		font-weight: bold;
	}
	.ranking {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		li {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 6px;
			background: var(--bg-secondary);
			font-size: var(--fs-small);
			&.you {
				box-shadow: inset 0 0 0 2px var(--border-primary);
			}
		}
	}
	.place {
		font-weight: bold;
		width: 2.2em;
	}
	.name {
		flex: 1;
		min-width: 0;
		font-weight: bold;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.outcome {
		color: var(--fg-secondary);
		&.solved {
			color: var(--color-correct);
			font-weight: bold;
		}
	}
	.wins {
		font-weight: bold;
	}
	.boards {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 16px;
	}
	.more {
		width: 100%;
		padding: 8px;
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background: none;
		color: var(--fg-primary);
		font: inherit;
		cursor: pointer;
	}
	.board {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.bname {
		font-weight: bold;
		font-size: var(--fs-small);
	}
	.ready {
		position: sticky;
		bottom: 0;
		background: var(--bg-primary);
		padding: 8px 0 4px;
		.button {
			margin-top: 10px;
		}
	}
	.who {
		max-height: 30vh;
		overflow-y: auto;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-small);
		padding: 3px 8px 3px 3px;
		border-radius: 14px;
		background: var(--bg-secondary);
		span {
			font-weight: bold;
			color: var(--fg-secondary);
		}
		&.on span {
			color: var(--color-correct);
		}
		&.offline {
			opacity: 0.5;
		}
	}
	.spectating {
		text-align: center;
		color: var(--fg-secondary);
		margin-top: 10px;
	}
	.count {
		text-align: center;
		color: var(--fg-secondary);
		font-size: var(--fs-tiny);
		margin-top: 6px;
	}
</style>
