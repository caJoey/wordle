<script lang="ts">
	import { onDestroy } from "svelte";
	import type { StadiumEventType } from "../../stadium";

	const SHOW_MS = 2600;
	const MAX_QUEUE = 3;

	type Line = { id: number; text: string; type: StadiumEventType; };

	let current: Line | null = null;
	let queue: Line[] = [];
	let id = 0;
	let timer: ReturnType<typeof setTimeout>;

	/** Queue a commentator line. A solve cuts straight in. */
	export function say(text: string, type: StadiumEventType) {
		const line = { id: ++id, text, type };
		if (type === "solve") {
			queue = [];
			show(line);
		} else if (!current) {
			show(line);
		} else {
			queue = [...queue, line].slice(-MAX_QUEUE);
		}
	}

	function show(line: Line) {
		clearTimeout(timer);
		current = line;
		timer = setTimeout(next, SHOW_MS);
	}

	function next() {
		const [head, ...rest] = queue;
		queue = rest;
		if (head) show(head);
		else current = null;
	}

	onDestroy(() => clearTimeout(timer));
</script>

<div class="booth" aria-live="polite">
	{#if current}
		{#key current.id}
			<div class="chyron {current.type}">
				<span class="live">🎙️ Live</span>
				<span class="text">{current.text}</span>
			</div>
		{/key}
	{/if}
</div>

<style lang="scss">
	.booth {
		position: absolute;
		left: 0;
		right: 0;
		top: 100%;
		margin-top: 6px;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: 5;
	}
	.chyron {
		display: flex;
		align-items: stretch;
		max-width: calc(100% - 24px);
		font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif;
		font-style: italic;
		font-weight: 800;
		text-transform: uppercase;
		filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
		animation: slam 2.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) forwards;
		> span {
			transform: skewX(-14deg);
			padding: 6px 12px;
		}
	}
	.live {
		flex-shrink: 0;
		background: #e11d48;
		color: #fff;
		font-size: 13px;
		letter-spacing: 1px;
		display: flex;
		align-items: center;
	}
	.text {
		background: #fff;
		color: #0b0f19;
		font-size: clamp(15px, 4.4vw, 20px);
		line-height: 1.1;
		letter-spacing: 0.3px;
		display: flex;
		align-items: center;
		border-right: 5px solid var(--accent, #ffd23f);
	}
	.solve {
		--accent: #22c55e;
		.text {
			background: linear-gradient(90deg, #ffd23f, #fff 60%);
		}
	}
	.cook,
	.lead {
		--accent: #ff8a1a;
	}
	.gasp,
	.fail {
		--accent: #6b7280;
	}
	@keyframes slam {
		0% { opacity: 0; transform: translateX(-40px) scale(1.25); }
		10% { opacity: 1; transform: translateX(0) scale(1); }
		88% { opacity: 1; transform: translateX(0); }
		100% { opacity: 0; transform: translateX(30px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.chyron {
			animation: none;
		}
	}
</style>
