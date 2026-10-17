<script lang="ts">
	import type { LetterState } from "../../../shared/protocol";
	import { COLS, ROWS } from "../../utils";

	/** One entry per submitted guess. */
	export let colors: LetterState[][];
	/** Guessed words aligned with colors. Omit to show colors only. */
	export let words: string[] = undefined;
	/** Tile size in px. */
	export let size = 12;
</script>

<div class="mini" class:letters={!!words} style="--size: {size}px">
	{#each Array(ROWS) as _, r}
		<div class="row">
			{#each Array(COLS) as _, c}
				<div class="tile {colors[r]?.[c] ?? 'empty'}">
					{#if words}{words[r]?.[c] ?? ""}{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style lang="scss">
	.mini {
		display: flex;
		flex-direction: column;
		gap: calc(var(--size) / 6 + 1px);
	}
	.row {
		display: flex;
		gap: calc(var(--size) / 6 + 1px);
	}
	.tile {
		width: var(--size);
		height: var(--size);
		border-radius: 2px;
		display: grid;
		place-items: center;
		font-size: calc(var(--size) * 0.6);
		font-weight: bold;
		text-transform: uppercase;
		line-height: 1;
		transition: background-color 0.3s ease;
	}
	.empty,
	.🔳 {
		border: 1px solid var(--border-primary);
	}
	.⬛ {
		background: var(--color-absent);
	}
	.🟨 {
		background: var(--color-present);
	}
	.🟩 {
		background: var(--color-correct);
	}
</style>
