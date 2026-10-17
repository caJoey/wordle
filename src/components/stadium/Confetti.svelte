<script lang="ts">
	import { onDestroy } from "svelte";

	type Piece = { x: number; y: number; vx: number; vy: number; r: number; spin: number; w: number; h: number; color: string; life: number; };

	const GRAVITY = 0.25;
	const DRAG = 0.985;

	let canvas: HTMLCanvasElement;
	let pieces: Piece[] = [];
	let frame = 0;

	/** Throw confetti up from the bottom corners of the screen. */
	export function fire(count = 150, colors = ["#ffd23f", "#ff2d55", "#23c4ff", "#2ee6a6", "#ffffff"]) {
		if (!canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const w = (canvas.width = innerWidth);
		const h = (canvas.height = innerHeight);
		for (let i = 0; i < count; ++i) {
			const left = i % 2 === 0;
			pieces.push({
				x: left ? 0 : w,
				y: h * 0.85,
				vx: (left ? 1 : -1) * (4 + Math.random() * 9),
				vy: -(10 + Math.random() * 12),
				r: Math.random() * Math.PI,
				spin: (Math.random() - 0.5) * 0.4,
				w: 6 + Math.random() * 6,
				h: 3 + Math.random() * 4,
				color: colors[i % colors.length],
				life: 1,
			});
		}
		if (!frame) frame = requestAnimationFrame(tick);
	}

	function tick() {
		const ctx = canvas.getContext("2d");
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		for (const p of pieces) {
			p.vx *= DRAG;
			p.vy = p.vy * DRAG + GRAVITY;
			p.x += p.vx;
			p.y += p.vy;
			p.r += p.spin;
			if (p.vy > 0) p.life -= 0.006;
			ctx.save();
			ctx.globalAlpha = Math.max(0, p.life);
			ctx.translate(p.x, p.y);
			ctx.rotate(p.r);
			ctx.fillStyle = p.color;
			// Squashing the width fakes a piece flipping over in the air
			ctx.fillRect(-p.w / 2, -p.h / 2, p.w * Math.cos(p.r * 2), p.h);
			ctx.restore();
		}
		pieces = pieces.filter((p) => p.life > 0 && p.y < canvas.height + 20);
		frame = pieces.length ? requestAnimationFrame(tick) : 0;
	}

	onDestroy(() => cancelAnimationFrame(frame));
</script>

<canvas bind:this={canvas} />

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 20;
	}
</style>
