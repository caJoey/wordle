import type { Scheduler } from "../lobby";

/** Manual clock: timers only fire when advance() is called. */
export class FakeScheduler implements Scheduler {
	time = 1_000_000;
	private nextId = 1;
	timers = new Map<number, { at: number; fn: () => void; }>();

	now = () => this.time;

	setTimeout = (fn: () => void, ms: number) => {
		const id = this.nextId++;
		this.timers.set(id, { at: this.time + ms, fn });
		return id;
	};

	clearTimeout = (h: unknown) => {
		this.timers.delete(h as number);
	};

	/** Advance time, firing due timers in order (timers scheduled while firing are honoured). */
	advance(ms: number) {
		const end = this.time + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void; }] | undefined;
			for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
			if (!next) break;
			this.timers.delete(next[0]);
			this.time = next[1].at;
			next[1].fn();
		}
		this.time = end;
	}

	get pending() {
		return this.timers.size;
	}
}

/** Let pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setImmediate(r));

export const silentLogger = { log() {}, error() {} };

/** Same shape as the ThemeError exported by server/words/gemma.ts (matched by name). */
export class ThemeError extends Error {}
