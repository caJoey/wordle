import { readable, writable } from "svelte/store";

export type Settings = {
	dark: boolean;
	colorblind: boolean;
	/** Crowd meters, commentary and confetti while playing. */
	stadium: boolean;
	crowdSound: boolean;
};

function loadSettings(): Settings {
	const defaults: Settings = { dark: true, colorblind: false, stadium: true, crowdSound: true };
	try {
		const parsed = JSON.parse(localStorage.getItem("settings") || "{}");
		return {
			dark: typeof parsed.dark === "boolean" ? parsed.dark : defaults.dark,
			colorblind: typeof parsed.colorblind === "boolean" ? parsed.colorblind : defaults.colorblind,
			stadium: typeof parsed.stadium === "boolean" ? parsed.stadium : defaults.stadium,
			crowdSound: typeof parsed.crowdSound === "boolean" ? parsed.crowdSound : defaults.crowdSound,
		};
	} catch {
		return defaults;
	}
}

export const settings = writable(loadSettings());
settings.subscribe((s) => {
	try {
		localStorage.setItem("settings", JSON.stringify(s));
	} catch { /* storage unavailable */ }
});

/** The player's display name, remembered between visits. */
export const playerName = writable(readLocal("name"));
playerName.subscribe((n) => {
	try {
		localStorage.setItem("name", n);
	} catch { /* storage unavailable */ }
});

function readLocal(key: string) {
	try {
		return localStorage.getItem(key) || "";
	} catch {
		return "";
	}
}

/** The local clock, ticking 4 times a second, for countdowns. */
export const now = readable(Date.now(), (set) => {
	const id = setInterval(() => set(Date.now()), 250);
	return () => clearInterval(id);
});
