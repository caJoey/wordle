<script lang="ts">
	import { CODE_LENGTH } from "../../../shared/protocol";
	import { createLobby, joinLobby, toast } from "../../socket";
	import { playerName } from "../../stores";

	const NAME_MAX_LENGTH = 16;

	const inviteCode = (new URLSearchParams(location.search).get("code") ?? "")
		.replace(/\D/g, "")
		.slice(0, CODE_LENGTH);
	const hasInvite = inviteCode.length === CODE_LENGTH;
	let code = inviteCode;
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
	<section class="welcome" aria-labelledby="welcome-title">
		<h2 id="welcome-title">{hasInvite ? "Join game" : "Wordle Multiplayer"}</h2>
	</section>

	<section class="game-card" aria-label="Start or join a game">
		<div class="field-group">
			<label class="label" for="name">Your name</label>
			<input
				id="name"
				class="field"
				bind:value={$playerName}
				maxlength={NAME_MAX_LENGTH}
				placeholder="Enter your name"
				autocomplete="nickname"
			/>
		</div>

		{#if hasInvite}
			<p class="invite-note">You’ve been invited to a game.</p>
			<button class="button create" disabled={busy || !name} on:click={join}>
				{busy ? "Joining game…" : "Join game"}
			</button>
		{:else}
			<button class="button create" disabled={busy} on:click={create}>Create game</button>

			<div class="divider"><span>Have a game code?</span></div>

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
		{/if}
	</section>
</div>

<style lang="scss">
	.home {
		width: 100%;
		flex: 1;
		margin: auto;
		padding: 32px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 28px;
	}
	.welcome {
		width: 100%;
		max-width: 420px;
		text-align: center;
	}
	h2 {
		font-size: clamp(28px, 8vw, 38px);
		line-height: 1.1;
		letter-spacing: -0.03em;
	}
	.game-card {
		width: 100%;
		max-width: 420px;
		padding: 22px;
		border: 1px solid var(--border-primary);
		border-radius: 12px;
		background: var(--bg-secondary);
	}
	.field-group {
		margin-bottom: 18px;
	}
	.field-group input {
		font-size: var(--fs-regular);
	}
	.invite-note {
		margin-bottom: 14px;
		color: var(--fg-secondary);
		text-align: center;
	}
	.create {
		margin-top: 0;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 20px 0 12px;
		color: var(--fg-secondary);
		font-size: var(--fs-tiny);
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.08em;
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
		.field {
			font-size: var(--fs-regular);
		}
		.button {
			margin-top: 0;
			width: 88px;
			padding: 0 14px;
		}
	}
	.code {
		flex: 1;
		min-width: 0;
		text-align: center;
		letter-spacing: 0.3em;
		font-weight: bold;
	}
	@media (max-height: 650px) {
		.home {
			gap: 18px;
			padding-top: 20px;
			padding-bottom: 20px;
		}
	}
</style>
