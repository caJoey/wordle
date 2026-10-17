<script lang="ts">
	import type { PlayerView } from "../../../shared/protocol";
	import { isValidGuess } from "../../../shared/wordle";
	import { me, snapshot, submitGuess, toast } from "../../socket";
	import {
		COLS,
		DELAY_INCREMENT,
		emptyBoard,
		isSolvedRow,
		letterStates,
		PRAISE,
		ROWS,
	} from "../../utils";
	import { Board, MiniBoard } from "../board";
	import Keyboard from "../keyboard";
	import { Avatar, Countdown } from "../widgets";

	let board = emptyBoard();
	let guesses = 0;
	let submitting = false;
	let boardEl: Board;

	// The server is authoritative: adopt any guesses it knows about that we don't (e.g. after a reload)
	$: sync($me);
	function sync(p: PlayerView | undefined) {
		if (!p?.words || p.colors.length <= guesses) return;
		for (let i = 0; i < p.colors.length; ++i) {
			board.words[i] = p.words[i] ?? "";
			board.state[i] = p.colors[i];
		}
		guesses = p.colors.length;
	}

	$: spectating = !$me || $me.spectating;
	$: solved = guesses > 0 && isSolvedRow(board.state[guesses - 1]);
	$: finished = spectating || solved || guesses >= ROWS || !!$me?.done;
	$: keyStates = letterStates(board.words.slice(0, guesses), board.state.slice(0, guesses));
	$: seats = $snapshot.players.map((p, index) => ({ p, index }));
	$: opponents = seats.filter((s) => s.p.id !== $snapshot.youId);
	$: playing = opponents.filter((s) => !s.p.spectating);
	$: waitingOn = playing.filter((s) => !s.p.done).length;

	async function submitWord() {
		if (submitting || finished) return;
		const row = guesses;
		const word = board.words[row];
		if (word.length !== COLS) {
			toast("Not enough letters", 1);
			return boardEl.shake(row);
		}
		if (!isValidGuess(word)) {
			toast("Not in word list", 1);
			return boardEl.shake(row);
		}
		submitting = true;
		const res = await submitGuess(word);
		submitting = false;
		if ("error" in res) {
			toast(res.error, 2);
			return boardEl.shake(row);
		}
		// A snapshot may already have filled this row in
		if (guesses === row) {
			board.state[row] = res.colors;
			guesses = row + 1;
		}
		if (isSolvedRow(res.colors)) {
			boardEl.bounce(row);
			setTimeout(() => toast(PRAISE[row], 2), DELAY_INCREMENT * COLS + DELAY_INCREMENT);
		} else if (row === ROWS - 1) {
			setTimeout(() => toast("Out of guesses", 2), DELAY_INCREMENT * COLS + DELAY_INCREMENT);
		}
	}

	function status(p: PlayerView) {
		if (p.spectating) return "next round";
		if (p.solved) return `solved in ${p.colors.length}`;
		if (p.done) return p.connected ? "out" : "left";
		return `${p.colors.length}/${ROWS}`;
	}
</script>

<div class="playing" class:guesses={guesses !== 0} style="--rows: {ROWS}; --cols: {COLS}">
	<div class="top">
		<div class="theme"><span>Theme</span> {$snapshot.theme ?? ""}</div>
		<Countdown endsAt={$snapshot.endsAt} total={$snapshot.roundSeconds} />
	</div>

	{#if opponents.length}
		<div class="opponents" class:big={spectating}>
			{#each opponents as { p, index } (p.id)}
				<div class="opponent" class:offline={!p.connected} class:solved={p.solved}>
					<div class="who">
						<Avatar name={p.name} {index} size={spectating ? 24 : 16} dim={!p.connected} />
						<span class="name">{p.name}</span>
					</div>
					<MiniBoard colors={p.colors} size={spectating ? 22 : 10} />
					<div class="status">
						{#if !p.connected && !p.done}offline · {/if}{status(p)}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if spectating}
		<div class="panel">
			<h2>You're spectating</h2>
			<p>You joined mid-round, you'll play from the next round.</p>
		</div>
	{:else}
		<Board bind:this={boardEl} bind:value={board.words} {board} {guesses} />
		{#if finished}
			<div class="panel">
				<h2>{solved ? `Solved in ${guesses}!` : "Out of guesses"}</h2>
				{#if waitingOn > 0}
					<p>
						Waiting for others<span class="dots"><span>.</span><span>.</span><span>.</span></span>
					</p>
				{/if}
			</div>
		{:else}
			<Keyboard
				letterStates={keyStates}
				bind:value={board.words[guesses === ROWS ? 0 : guesses]}
				on:submitWord={submitWord}
				disabled={finished || submitting}
			/>
		{/if}
	{/if}
</div>

<style lang="scss">
	.playing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		height: 100%;
		width: 100%;
		min-height: 0;
	}
	.top {
		width: 100%;
		padding: 6px 12px 4px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.theme {
		text-align: center;
		font-weight: bold;
		font-size: var(--fs-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		span {
			color: var(--fg-secondary);
			text-transform: uppercase;
			font-size: var(--fs-tiny);
			letter-spacing: 1px;
			margin-right: 4px;
		}
	}
	.opponents {
		display: flex;
		justify-content: center;
		gap: 8px;
		padding: 4px 8px;
		width: 100%;
		flex-shrink: 0;
		&.big {
			flex-wrap: wrap;
			gap: 16px;
			padding: 16px 8px;
		}
	}
	.opponent {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px 6px;
		border-radius: 6px;
		background: var(--bg-secondary);
		min-width: 0;
		max-width: 33%;
		.big & {
			max-width: none;
			padding: 8px 12px;
		}
		&.offline {
			opacity: 0.5;
		}
		&.solved {
			box-shadow: inset 0 0 0 2px var(--color-correct);
		}
	}
	.who {
		display: flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
	}
	.name,
	.status {
		font-size: var(--fs-tiny);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		font-weight: bold;
	}
	.status {
		color: var(--fg-secondary);
		text-transform: uppercase;
	}
	.panel {
		text-align: center;
		padding: 16px;
		margin-bottom: auto;
		h2 {
			font-size: var(--fs-medium);
			margin-bottom: 6px;
		}
		p {
			color: var(--fg-secondary);
		}
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
