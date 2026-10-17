<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import GameIcon from "./GameIcon.svelte";

	export let inLobby: boolean;

	const dispatch = createEventDispatcher();
</script>

<header>
	<div class="icons">
		<GameIcon onClick={() => dispatch("settings")}>
			<title>Settings</title>
			<path
				d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"
			/>
		</GameIcon>
	</div>
	<h1>wordle+ <span>party</span></h1>
	<div class="icons">
		{#if inLobby}
			<GameIcon onClick={() => dispatch("leave")}>
				<title>Leave game</title>
				<path
					d="M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
				/>
			</GameIcon>
		{/if}
	</div>
</header>

<style lang="scss">
	header {
		--height: 51px;
		position: relative;
		flex-shrink: 0;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--border-primary);
		width: 100%;
		height: var(--height);
		padding: 0 4px;
	}
	.icons {
		height: 100%;
		min-width: 32px;
		z-index: 1;
		display: flex;
		align-items: center;
	}
	h1 {
		position: absolute;
		width: max-content;
		left: 50%;
		transform: translateX(-50%);
		font-size: var(--fs-large);
		text-align: center;
		span {
			font-size: var(--fs-small);
			color: var(--color-correct);
			letter-spacing: 0.1rem;
		}
	}
</style>
