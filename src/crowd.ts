/**
 * Synthesized stadium crowd: an ambient roar that follows the hype level, plus one-shot gasps,
 * "ooh"s, roars and an air horn. Everything is generated with Web Audio, so there are no sound files.
 * Browsers only allow audio after a user gesture, so nothing plays until unlock() is called from one.
 */

let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let bed: { gain: GainNode; filter: BiquadFilterNode; sources: AudioScheduledSourceNode[]; } | null = null;
let muted = false;
/** The crowd bed should be playing, as soon as audio is allowed. */
let wanted = false;

function context() {
	if (ctx) return ctx;
	const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
	if (!Ctor) return null;
	ctx = new Ctor() as AudioContext;
	master = ctx.createGain();
	master.gain.value = muted ? 0 : 0.8;
	master.connect(ctx.destination);
	// Two seconds of pinkish noise, the raw material for every crowd sound
	const length = ctx.sampleRate * 2;
	noise = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = noise.getChannelData(0);
	let b0 = 0, b1 = 0, b2 = 0;
	for (let i = 0; i < length; ++i) {
		const white = Math.random() * 2 - 1;
		b0 = 0.99765 * b0 + white * 0.099046;
		b1 = 0.963 * b1 + white * 0.2965164;
		b2 = 0.57 * b2 + white * 1.0526913;
		data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
	}
	return ctx;
}

/** Call from a user gesture (key press, tap) so the browser lets the crowd be heard. */
export function unlock() {
	const c = context();
	if (!c) return;
	if (c.state === "suspended") c.resume();
	if (wanted) buildBed(c);
}

export function setMuted(value: boolean) {
	muted = value;
	if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.1);
}

function noiseSource(c: AudioContext, loop = false) {
	const src = c.createBufferSource();
	src.buffer = noise;
	src.loop = loop;
	// Start somewhere random so overlapping sounds don't phase into each other
	return { src, offset: Math.random() * 1.5 };
}

/** Start the ambient crowd bed, now if audio is unlocked or else on the next unlock(). It idles quietly until setHype() turns it up. */
export function startCrowd() {
	wanted = true;
	if (ctx) buildBed(ctx);
}

function buildBed(c: AudioContext) {
	if (bed) return;
	const gain = c.createGain();
	gain.gain.value = 0;
	const filter = c.createBiquadFilter();
	filter.type = "bandpass";
	filter.frequency.value = 600;
	filter.Q.value = 0.6;
	filter.connect(gain).connect(master);
	const sources: AudioScheduledSourceNode[] = [];
	// A few voices with slow, independent swells sound like a crowd rather than static
	for (const rate of [0.13, 0.21, 0.34]) {
		const { src, offset } = noiseSource(c, true);
		const voice = c.createGain();
		voice.gain.value = 0.5;
		const lfo = c.createOscillator();
		lfo.frequency.value = rate;
		const depth = c.createGain();
		depth.gain.value = 0.3;
		lfo.connect(depth).connect(voice.gain);
		src.connect(voice).connect(filter);
		src.start(0, offset);
		lfo.start();
		sources.push(src, lfo);
	}
	bed = { gain, filter, sources };
}

/** Fade the crowd out and release it, e.g. when the round ends. */
export function stopCrowd() {
	wanted = false;
	if (!ctx || !bed) return;
	const { gain, sources } = bed;
	const end = ctx.currentTime + 1.5;
	gain.gain.cancelScheduledValues(ctx.currentTime);
	gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
	for (const s of sources) s.stop(end);
	bed = null;
}

/** 0..100: louder and brighter as the crowd gets into it. */
export function setHype(hype: number) {
	if (!ctx || !bed) return;
	const h = Math.max(0, Math.min(1, hype / 100));
	const t = ctx.currentTime;
	bed.gain.gain.setTargetAtTime(0.04 + 0.32 * h * h, t, 0.6);
	bed.filter.frequency.setTargetAtTime(450 + 900 * h, t, 0.6);
}

/** A burst of filtered noise shaped by an envelope and a filter sweep. */
function burst(opts: { attack: number; hold: number; release: number; peak: number; from: number; to: number; q: number; }) {
	const c = ctx;
	if (!c || c.state !== "running") return;
	const t = c.currentTime;
	const { src, offset } = noiseSource(c);
	const filter = c.createBiquadFilter();
	filter.type = "bandpass";
	filter.Q.value = opts.q;
	filter.frequency.setValueAtTime(opts.from, t);
	filter.frequency.exponentialRampToValueAtTime(opts.to, t + opts.attack + opts.hold + opts.release);
	const gain = c.createGain();
	gain.gain.setValueAtTime(0.0001, t);
	gain.gain.exponentialRampToValueAtTime(opts.peak, t + opts.attack);
	gain.gain.setValueAtTime(opts.peak, t + opts.attack + opts.hold);
	gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.hold + opts.release);
	src.connect(filter).connect(gain).connect(master);
	src.start(t, offset);
	src.stop(t + opts.attack + opts.hold + opts.release + 0.1);
}

/** The sharp intake of a crowd watching a fumble. */
export function gasp() {
	burst({ attack: 0.04, hold: 0.1, release: 0.7, peak: 0.5, from: 1800, to: 500, q: 1.2 });
}

/** A rising "ooooh" as someone gets close. */
export function ooh() {
	burst({ attack: 0.5, hold: 0.4, release: 0.9, peak: 0.45, from: 400, to: 1100, q: 1.5 });
}

/** A falling "awww" for someone running out of guesses. */
export function aww() {
	burst({ attack: 0.2, hold: 0.3, release: 1.2, peak: 0.35, from: 900, to: 250, q: 1.8 });
}

/** Full stadium roar. */
export function roar(big = true) {
	burst({ attack: 0.25, hold: big ? 2.2 : 1, release: 2, peak: big ? 0.9 : 0.5, from: 700, to: 1400, q: 0.4 });
	burst({ attack: 0.3, hold: big ? 1.8 : 0.8, release: 1.8, peak: big ? 0.5 : 0.3, from: 2500, to: 1800, q: 0.8 });
}

/** BWAAAP BWAAAP. */
export function airHorn() {
	const c = ctx;
	if (!c || c.state !== "running") return;
	const start = c.currentTime;
	[0, 0.32, 0.64].forEach((delay, i) => {
		const t = start + delay;
		const length = i === 2 ? 0.9 : 0.25;
		const filter = c.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 2400;
		const gain = c.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
		gain.gain.setValueAtTime(0.18, t + length);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.08);
		filter.connect(gain).connect(master);
		for (const freq of [466, 554, 698]) {
			const osc = c.createOscillator();
			osc.type = "sawtooth";
			osc.frequency.setValueAtTime(freq * 0.97, t);
			osc.frequency.linearRampToValueAtTime(freq, t + 0.05);
			osc.connect(filter);
			osc.start(t);
			osc.stop(t + length + 0.1);
		}
	});
}
