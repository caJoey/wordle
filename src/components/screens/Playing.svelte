<script lang="ts">
	import { onDestroy } from "svelte";
	import type { PlayerView } from "../../../shared/protocol";
	import { isValidGuess } from "../../../shared/wordle";
	import * as crowd from "../../crowd";
	import { me, snapshot, submitGuess, toast } from "../../socket";
	import { commentary, StadiumTracker, type StadiumEvent } from "../../stadium";
	import { now, settings } from "../../stores";
	import {
		COLS,
		DELAY_INCREMENT,
		emptyBoard,
		isSolvedRow,
		letterStates,
		PRAISE,
		ROWS,
		SEAT_COLORS,
	} from "../../utils";
	import { Board, MiniBoard } from "../board";
	import Keyboard from "../keyboard";
	import { Commentary, Confetti, PulseMeter } from "../stadium";
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
	// Closest to solving first, so the biggest threats stay on screen in a big lobby
	$: opponents = seats.filter((s) => s.p.id !== $snapshot.youId).sort((a, b) => threat(b.p) - threat(a.p));
	$: many = opponents.length > 3;
	$: playing = opponents.filter((s) => !s.p.spectating);
	$: waitingOn = playing.filter((s) => !s.p.done).length;
	$: mySeat = seats.find((s) => s.p.id === $snapshot.youId);

	// Stadium mode
	/** How long your own row takes to flip, so the crowd doesn't react before you see the colors. */
	const REVEAL_MS = DELAY_INCREMENT * COLS;
	const tracker = new StadiumTracker();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let hype: Record<string, number> = {};
	let booth: Commentary;
	let confetti: Confetti;
	let flash = false;
	let myGuesses = $me?.colors.length ?? 0;
	let holdMineUntil = 0;

	$: stadium = $settings.stadium;
	$: crowd.setMuted(!$settings.crowdSound);
	$: if (stadium) crowd.startCrowd();
	else crowd.stopCrowd();
	$: react($snapshot.players);
	$: $now, measure();
	// Like a maxed-out road crowd in CFB: an opponent at full hype rattles your board
	$: rattled = stadium && !finished && playing.some((s) => !s.p.solved && (hype[s.p.id] ?? 0) >= 95);

	onDestroy(() => {
		crowd.stopCrowd();
		timers.forEach(clearTimeout);
	});

	function later(ms: number, fn: () => void) {
		const t = setTimeout(() => {
			timers.delete(t);
			fn();
		}, ms);
		timers.add(t);
	}

	function react(players: PlayerView[]) {
		const mine = players.find((p) => p.id === $snapshot.youId)?.colors.length ?? 0;
		if (mine > myGuesses) holdMineUntil = Date.now() + REVEAL_MS;
		myGuesses = mine;
		for (const e of tracker.update(players, Date.now())) {
			later(e.playerId === $snapshot.youId ? REVEAL_MS : 0, () => cheer(e));
		}
		measure();
	}

	function measure() {
		const next = Object.fromEntries(tracker.hypes($snapshot.players, Date.now()).map((h) => [h.id, h.hype]));
		// Keep your meter where it was until your row has flipped
		if (Date.now() < holdMineUntil && $snapshot.youId in hype) next[$snapshot.youId] = hype[$snapshot.youId];
		hype = next;
		// The soundtrack follows your meter, or the hottest player's while you spectate
		crowd.setHype(hype[$snapshot.youId] ?? Math.max(0, ...Object.values(hype)));
	}

	function cheer(e: StadiumEvent) {
		const seat = seats.find((s) => s.p.id === e.playerId);
		if (!stadium || !seat) return;
		const isYou = e.playerId === $snapshot.youId;
		booth?.say(commentary(e, seat.p.name, isYou), e.type);
		if (e.type !== "solve") return;
		confetti?.fire(isYou ? 180 : 60, [seatColor(seat.index), "#ffd23f", "#ffffff", "#ff2d55", "#23c4ff"]);
		if (isYou) {
			flash = true;
			later(700, () => (flash = false));
		}
	}

	function seatColor(index: number) {
		return SEAT_COLORS[index % SEAT_COLORS.length];
	}

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

	function threat(p: PlayerView) {
		if (p.spectating) return -1;
		if (p.solved) return 100 - p.colors.length;
		return Math.max(0, ...p.colors.map((r) => r.filter((c) => c === "🟩").length * 10 + r.filter((c) => c === "🟨").length));
	}

	function status(p: PlayerView) {
		if (p.spectating) return "next round";
		if (p.solved) return `solved in ${p.colors.length}`;
		if (p.done) return p.connected ? "out" : "left";
		return `${p.colors.length}/${ROWS}`;
	}
</script>

<div class="playing" class:guesses={guesses !== 0} class:rattled style="--rows: {ROWS}; --cols: {COLS}">
	<div class="top">
		<div class="theme"><span>Theme</span> {$snapshot.theme ?? ""}</div>
		<Countdown endsAt={$snapshot.endsAt} total={$snapshot.roundSeconds} />
	</div>

	{#if stadium}
		<div class="stage">
			{#if !spectating && mySeat}
				<PulseMeter hype={hype[mySeat.p.id] ?? 0} color={seatColor(mySeat.index)} name="You" />
			{/if}
			<Commentary bind:this={booth} />
		</div>
	{/if}

	{#if opponents.length}
		<div class="opponents" class:big={spectating} class:many>
			{#each opponents as { p, index } (p.id)}
				<div
					class="opponent"
					class:offline={!p.connected}
					class:solved={p.solved}
					class:onfire={stadium && !p.solved && (hype[p.id] ?? 0) >= 80}
				>
					<div class="who">
						<Avatar name={p.name} {index} size={spectating ? 24 : 16} dim={!p.connected} bot={p.bot} />
						<span class="name">{p.name}</span>
					</div>
					<MiniBoard colors={p.colors} size={spectating ? 22 : 10} />
					{#if stadium && p.id in hype}
						<PulseMeter compact hype={hype[p.id]} />
					{/if}
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

<Confetti bind:this={confetti} />
{#if flash}<div class="flash" />{/if}

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
	.stage {
		position: relative;
		width: 100%;
		padding: 2px 4px 4px;
		flex-shrink: 0;
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
		&.many {
			flex-wrap: wrap;
			max-height: 28vh;
			overflow-y: auto;
			.opponent {
				max-width: none;
				width: 72px;
			}
		}
		&.big.many {
			max-height: none;
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
		&.onfire {
			box-shadow: inset 0 0 0 2px #ff8a1a, 0 0 12px rgba(255, 138, 26, 0.6);
		}
	}
	.rattled :global(.board) {
		animation: rattle 2.4s ease-in-out infinite;
	}
	.flash {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 19;
		background: radial-gradient(circle, rgba(255, 210, 63, 0.55), transparent 70%);
		animation: flash 0.7s ease-out forwards;
	}
	@keyframes rattle {
		0%, 80%, 100% { transform: none; }
		84% { transform: translate(-3px, 1px) rotate(-0.4deg); }
		88% { transform: translate(3px, -1px) rotate(0.4deg); }
		92% { transform: translate(-2px, 0) rotate(-0.2deg); }
		96% { transform: translate(2px, 1px); }
	}
	@keyframes flash {
		from { opacity: 1; }
		to { opacity: 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.rattled :global(.board),
		.flash {
			animation: none;
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
