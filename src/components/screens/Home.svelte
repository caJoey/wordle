<script lang="ts">
	import { CODE_LENGTH, MAX_PLAYERS } from "../../../shared/protocol";
	import { createLobby, joinLobby, toast } from "../../socket";
	import { playerName } from "../../stores";

	const NAME_MAX_LENGTH = 16;

	let code = (new URLSearchParams(location.search).get("code") ?? "")
		.replace(/\D/g, "")
		.slice(0, CODE_LENGTH);
	let busy = false;

	$: code = code.replace(/\D/g, "").slice(0, CODE_LENGTH);
	$: name = $playerName.trim();
	$: canJoin = code.length === CODE_LENGTH;

	function checkName() {
		if (!name) {
			toast("Enter your name first");
			return false;
		}
		return true;
	}

	async function create() {
		if (busy || !checkName()) return;
		busy = true;
		const res = await createLobby(name);
		busy = false;
		if ("error" in res) toast(res.error, 3);
	}

	async function join() {
		if (busy || !checkName()) return;
		if (!canJoin) return toast(`Enter the ${CODE_LENGTH} digit code`);
		busy = true;
		const res = await joinLobby(code, name);
		busy = false;
		if ("error" in res) {
			toast(res.error, 3);
		} else {
			// Drop ?code so leaving later doesn't prefill a stale code
			history.replaceState(null, "", location.pathname);
		}
	}
</script>

<div class="home">
	<div class="hero">
		<div class="tiles">
			{#each "THEME" as letter, i}
				<div class="tile" style="--i: {i}">{letter}</div>
			{/each}
		</div>
		<p>Pick a theme. Race your friends. 1–{MAX_PLAYERS} players.</p>
	</div>

	<div class="field-group">
		<label class="label" for="name">Your name</label>
		<input
			id="name"
			class="field"
			bind:value={$playerName}
			maxlength={NAME_MAX_LENGTH}
			placeholder="Name"
			autocomplete="nickname"
		/>
	</div>

	<button class="button" disabled={busy} on:click={create}>Create game</button>

	<div class="divider"><span>or join a friend</span></div>

	<form class="join" on:submit|preventDefault={join}>
		<input
			class="field code"
			bind:value={code}
			inputmode="numeric"
			pattern="[0-9]*"
			maxlength={CODE_LENGTH}
			placeholder={"0".repeat(CODE_LENGTH)}
			aria-label="Game code"
			autocomplete="off"
		/>
		<button class="button secondary" type="submit" disabled={busy || !canJoin}>Join</button>
	</form>
</div>

<style lang="scss">
	.home {
		width: 100%;
		max-width: 360px;
		margin: auto;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
	}
	.hero {
		text-align: center;
		margin-bottom: 24px;
		p {
			color: var(--fg-secondary);
			margin-top: 14px;
		}
	}
	.tiles {
		display: flex;
		justify-content: center;
		gap: 6px;
	}
	.tile {
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		font-size: 1.8rem;
		font-weight: bold;
		color: #fff;
		background: var(--color-correct);
		animation: flip 0.6s ease calc(var(--i) * 0.15s) backwards;
		&:nth-child(2n) {
			background: var(--color-present);
		}
	}
	@keyframes flip {
		from {
			transform: rotateX(90deg);
		}
	}
	.field-group {
		margin-bottom: 0;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 24px 0 12px;
		color: var(--fg-secondary);
		font-size: var(--fs-small);
		text-transform: uppercase;
		&::before,
		&::after {
			content: "";
			flex: 1;
			border-top: 1px solid var(--border-primary);
		}
	}
	.join {
		display: flex;
		gap: 8px;
		align-items: stretch;
		.button {
			margin-top: 0;
			width: auto;
			padding: 0 20px;
		}
	}
	.code {
		flex: 1;
		min-width: 0;
		text-align: center;
		letter-spacing: 0.4em;
		font-weight: bold;
	}
</style>
