<script lang="ts">
	import { createEventDispatcher } from "svelte";

	const dispatch = createEventDispatcher();
	let guess = "";

	function submitGuess(): void {
		if (guess.length !== 5) return;

		dispatch("guess", guess.toLowerCase());
		guess = "";
	}
</script>

<form class="guess-form" on:submit|preventDefault={submitGuess}>
	<input
		bind:value={guess}
		maxlength="5"
		minlength="5"
		pattern="[A-Za-z]{5}"
		autocomplete="off"
		placeholder="5-letter guess"
	/>
	<button type="submit" disabled={guess.length !== 5}>Guess</button>
</form>

<style>
	.guess-form {
		display: flex;
		gap: 8px;
		margin: 14px 0;
	}

	.guess-form input {
		flex: 1;
		text-transform: uppercase;
	}
</style>
