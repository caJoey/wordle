<script lang="ts">
	import { onMount } from "svelte";
	import { THEME_MAX_LENGTH, THEME_PICK_SECONDS } from "../../../shared/protocol";
	import { snapshot, submitTheme, toast } from "../../socket";
	import { Avatar, Countdown } from "../widgets";

	const SUGGESTIONS = ["Animals", "Food", "Space", "Sports", "Music", "Weather", "Kitchen", "Ocean"];

	let theme = "";
	let sending = false;
	let input: HTMLInputElement;

	$: pickerIndex = $snapshot.players.findIndex((p) => p.id === $snapshot.pickerId);
	$: picker = $snapshot.players[pickerIndex];
	$: isPicker = $snapshot.pickerId === $snapshot.youId;

	onMount(() => input?.focus());

	async function submit() {
		const t = theme.trim();
		if (!t) return toast("Type a theme first");
		sending = true;
		const res = await submitTheme(t);
		sending = false;
		if ("error" in res) toast(res.error, 3);
	}
</script>

<div class="pick">
	<div class="round">Round {$snapshot.roundId}</div>
	{#if picker}
		<Avatar name={picker.name} index={pickerIndex} size={64} />
	{/if}

	{#if isPicker}
		<h2>Your turn to pick a theme</h2>
		<p class="hint">Everyone will guess a 5 letter word that fits it.</p>
		<form on:submit|preventDefault={submit}>
			<input
				bind:this={input}
				class="field"
				bind:value={theme}
				maxlength={THEME_MAX_LENGTH}
				placeholder="e.g. Things at the beach"
				autocomplete="off"
				disabled={sending}
			/>
			<div class="count">{theme.length}/{THEME_MAX_LENGTH}</div>
			<div class="suggestions">
				{#each SUGGESTIONS as s}
					<button type="button" class="chip" on:click={() => (theme = s)}>{s}</button>
				{/each}
			</div>
			<button class="button" type="submit" disabled={sending || !theme.trim()}>
				Use this theme
			</button>
		</form>
	{:else}
		<h2>{picker?.name ?? "Someone"} is choosing a theme</h2>
		<p class="hint">Get ready to guess…</p>
	{/if}

	<div class="timer">
		<Countdown endsAt={$snapshot.endsAt} total={THEME_PICK_SECONDS} />
	</div>
</div>

<style lang="scss">
	.pick {
		flex: 1;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}
	.round {
		font-size: var(--fs-small);
		text-transform: uppercase;
		letter-spacing: 2px;
		color: var(--fg-secondary);
	}
	h2 {
		font-size: var(--fs-medium);
	}
	.hint {
		color: var(--fg-secondary);
		font-size: var(--fs-small);
	}
	form {
		width: 100%;
		.button {
			margin-top: 12px;
		}
	}
	.count {
		text-align: right;
		font-size: var(--fs-tiny);
		color: var(--fg-secondary);
		margin-top: 4px;
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin-top: 8px;
	}
	.chip {
		font: inherit;
		font-size: var(--fs-small);
		padding: 6px 12px;
		border-radius: 16px;
		border: 1px solid var(--border-primary);
		background: var(--bg-secondary);
		color: var(--fg-primary);
		cursor: pointer;
	}
	.timer {
		width: 100%;
		margin-top: auto;
	}
</style>
