<script lang="ts">
	import type { GameBoard } from "../../utils";
	import Row from "./Row.svelte";

	export let value: string[];
	export let board: GameBoard;
	export let guesses: number;
	export function shake(row: number) {
		rows[row]?.shake();
	}
	export function bounce(row: number) {
		rows[row]?.bounce();
	}

	let rows: Row[] = [];
</script>

<div class="board">
	{#each value as _, i}
		<Row num={i} {guesses} bind:this={rows[i]} bind:value={value[i]} state={board.state[i]} />
	{/each}
</div>

<style>
	.board {
		display: grid;
		grid-template-rows: repeat(var(--rows), 1fr);
		gap: 5.5px;
		max-height: 420px;
		flex-grow: 1;
		min-height: 0;
		aspect-ratio: var(--cols) / var(--rows);
		padding: 10px;
		position: relative;
	}
</style>
