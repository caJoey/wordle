/**
 * Stadium soundtrack: a looped track that speeds up as the crowd meter rises and slows as it falls.
 * Browsers only allow audio after a user gesture, so nothing plays until unlock() is called from one.
 */
import soundtrackUrl from "../Soundtrack.mp3";

/** Playback speed at an empty meter and at a full one. */
const MIN_RATE = 0.85;
const MAX_RATE = 1.4;
/**
 * Safari restarts playback whenever playbackRate is set, so if it changes every tick the track never
 * gets going. Move in coarse steps, and not too often.
 */
const RATE_STEP = 0.05;
const MIN_RATE_CHANGE_MS = 1500;
const VOLUME = 0.6;
const FADE_MS = 1000;

let audio: HTMLAudioElement | null = null;
let muted = false;
/** The soundtrack should be playing, as soon as audio is allowed. */
let wanted = false;
let rate = 1;
let rateChangedAt = 0;
/** Played once during a user gesture, which Safari requires before it allows play() at other times. */
let blessed = false;
let fade: ReturnType<typeof setInterval> | undefined;

function track() {
	if (audio) return audio;
	audio = new Audio(soundtrackUrl);
	audio.loop = true;
	audio.preload = "auto";
	audio.volume = VOLUME;
	// Faster, not higher: keep the pitch where it is as the speed changes
	audio.preservesPitch = true;
	return audio;
}

function play() {
	const a = track();
	clearInterval(fade);
	a.volume = VOLUME;
	a.muted = muted;
	a.playbackRate = rate;
	// Rejected until the first user gesture; unlock() tries again then
	a.play().catch(() => {});
}

/** Call from a user gesture (key press, tap) so the browser lets the soundtrack play. */
export function unlock() {
	if (wanted) {
		if (!audio || audio.paused) play();
		return;
	}
	if (blessed) return;
	blessed = true;
	// Not needed yet: play silently for a moment so the round can start it later without a gesture
	const a = track();
	a.muted = true;
	a.play().then(() => {
		if (!wanted) a.pause();
		a.muted = muted;
	}, () => (blessed = false));
}

export function setMuted(value: boolean) {
	muted = value;
	if (audio) audio.muted = muted;
}

/** Start the soundtrack, now if audio is unlocked or else on the next unlock(). */
export function startCrowd() {
	wanted = true;
	play();
}

/** Fade the soundtrack out and pause it, e.g. when the round ends. */
export function stopCrowd() {
	wanted = false;
	const a = audio;
	if (!a || a.paused) return;
	clearInterval(fade);
	const step = VOLUME / (FADE_MS / 50);
	fade = setInterval(() => {
		a.volume = Math.max(0, a.volume - step);
		if (a.volume > 0) return;
		clearInterval(fade);
		a.pause();
		a.volume = VOLUME;
	}, 50);
}

/** 0..100: the higher the meter, the faster the soundtrack. */
export function setHype(hype: number) {
	const h = Math.max(0, Math.min(1, hype / 100));
	const target = Math.round((MIN_RATE + (MAX_RATE - MIN_RATE) * h) / RATE_STEP) * RATE_STEP;
	const now = Date.now();
	if (Math.abs(target - rate) < RATE_STEP / 2 || now - rateChangedAt < MIN_RATE_CHANGE_MS) return;
	rate = target;
	rateChangedAt = now;
	if (audio && !audio.paused) audio.playbackRate = rate;
}
