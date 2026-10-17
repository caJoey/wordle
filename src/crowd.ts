/**
 * Stadium soundtrack: a looped track that speeds up as the crowd meter rises and slows as it falls.
 * Played through Web Audio rather than an <audio> element: Safari restarts an element's playback every
 * time its speed changes, which skips, while a buffer source glides smoothly and loops without a gap.
 * Browsers only allow audio after a user gesture, so nothing plays until unlock() is called from one.
 */
import soundtrackUrl from "../Soundtrack.mp3";

/** Playback speed at an empty meter and at a full one. Like a "sped up" edit, pitch rises with speed. */
const MIN_RATE = 0.9;
const MAX_RATE = 1.35;
/** Seconds for the speed to settle most of the way to a new meter level. */
const RATE_GLIDE = 0.8;
const VOLUME = 0.6;
const FADE = 0.3;

let ctx: AudioContext | null = null;
/** Mute switch, shared by every playthrough. */
let master: GainNode;
let buffer: Promise<AudioBuffer> | null = null;
let playing: { source: AudioBufferSourceNode; fade: GainNode; } | null = null;
let starting = false;
let muted = false;
/** The soundtrack should be playing, as soon as audio is allowed. */
let wanted = false;
let rate = 1;

function context() {
	if (ctx) return ctx;
	const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
	if (!Ctor) return null;
	ctx = new Ctor() as AudioContext;
	master = ctx.createGain();
	master.gain.value = muted ? 0 : VOLUME;
	master.connect(ctx.destination);
	return ctx;
}

function load(c: AudioContext) {
	buffer ??= fetch(soundtrackUrl)
		.then((r) => r.arrayBuffer())
		.then((data) => new Promise<AudioBuffer>((resolve, reject) => c.decodeAudioData(data, resolve, reject)));
	buffer.catch(() => (buffer = null));
	return buffer;
}

async function start() {
	const c = context();
	if (!c || playing || starting) return;
	starting = true;
	try {
		const track = await load(c);
		if (!wanted || playing) return;
		const source = c.createBufferSource();
		source.buffer = track;
		source.loop = true;
		source.playbackRate.value = rate;
		const fade = c.createGain();
		fade.gain.setValueAtTime(0, c.currentTime);
		fade.gain.setTargetAtTime(1, c.currentTime, FADE);
		source.connect(fade).connect(master);
		source.start();
		playing = { source, fade };
	} catch {
		// Couldn't fetch or decode the track: stay silent rather than break the game
	} finally {
		starting = false;
	}
}

/** Call from a user gesture (key press, tap) so the browser lets the soundtrack play. */
export function unlock() {
	const c = context();
	if (!c) return;
	if (c.state !== "running") c.resume();
	load(c);
	if (wanted) start();
}

export function setMuted(value: boolean) {
	muted = value;
	if (ctx) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05);
}

/** Start the soundtrack from the top, now if audio is unlocked or else on the next unlock(). */
export function startCrowd() {
	wanted = true;
	if (ctx) start();
}

/** Fade the soundtrack out and stop it, e.g. when the round ends. */
export function stopCrowd() {
	wanted = false;
	if (!ctx || !playing) return;
	const { source, fade } = playing;
	fade.gain.setTargetAtTime(0, ctx.currentTime, FADE);
	source.stop(ctx.currentTime + FADE * 5);
	playing = null;
}

/** 0..100: the higher the meter, the faster the soundtrack. */
export function setHype(hype: number) {
	const h = Math.max(0, Math.min(1, hype / 100));
	const target = MIN_RATE + (MAX_RATE - MIN_RATE) * h;
	// Called every tick: only schedule a glide when the speed actually moves
	if (Math.abs(target - rate) < 0.005) return;
	rate = target;
	if (ctx && playing) playing.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, RATE_GLIDE / 3);
}
