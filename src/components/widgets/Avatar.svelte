<script lang="ts">
	import { SEAT_COLORS } from "../../utils";

	export let name: string;
	/** Seat in the lobby, picks the color. */
	export let index = 0;
	export let size = 32;
	export let dim = false;
	export let bot = false;
</script>

<div
	class="avatar"
	class:dim
	style="--size: {size}px; background: {SEAT_COLORS[index % SEAT_COLORS.length]}"
	title={name}
>
	{bot ? "🤖" : name.trim().charAt(0).toUpperCase() || "?"}
</div>

<style>
	.avatar {
		width: var(--size);
		height: var(--size);
		flex-shrink: 0;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: #fff;
		font-weight: bold;
		font-size: calc(var(--size) * 0.5);
		transition: opacity 0.3s ease;
	}
	.dim {
		opacity: 0.35;
	}
</style>
