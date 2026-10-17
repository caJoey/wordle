/**
 * Measure theme generation: latency, words returned by the model, how many are valid answer words.
 *   npx tsx scripts/eval-themes.ts            # mock mode, no network
 *   npx tsx scripts/eval-themes.ts --real     # real Gemma API (uses GEMMA_API from .env)
 *   npx tsx scripts/eval-themes.ts --real --limit 5 "space" "cooking"
 */
import { generatePool, setFetch, ThemeError } from "../server/words/gemma";

try {
	process.loadEnvFile();
} catch {
	// no .env
}

const args = process.argv.slice(2);
const real = args.includes("--real");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const custom = args.filter((a, i) => !a.startsWith("--") && i !== limitAt + 1);

const THEMES = [
	"animals", "cooking", "outer space", "music", "the ocean",
	"sports", "weather", "fantasy", "computers", "emotions",
];
const themes = (custom.length ? custom : THEMES).slice(0, limit);

process.env.GEMMA_MOCK = real ? "0" : "1";
if (real && !process.env.GEMMA_API) {
	console.error("--real needs GEMMA_API in .env");
	process.exit(1);
}

/** Record every raw model reply so we can count words before filtering. */
let replies: string[] = [];
if (real) {
	setFetch(async (url, init) => {
		const res = await fetch(url, init);
		const json = await res.clone().json().catch(() => ({}));
		const parts: { text?: string, thought?: boolean; }[] = json?.candidates?.[0]?.content?.parts ?? [];
		replies.push(parts.filter((p) => !p.thought).map((p) => p.text ?? "").join(""));
		return res;
	});
}

function rawWords(text: string): string[] {
	try {
		const arr = JSON.parse(text.match(/\[[^\[\]]*\]/)?.[0] ?? "[]");
		return Array.isArray(arr) ? arr.map((w) => String(w).trim().toLowerCase()) : [];
	} catch {
		return [];
	}
}

let totalMs = 0, totalReturned = 0, totalValid = 0, ok = 0;
for (const theme of themes) {
	replies = [];
	const t = Date.now();
	let words: string[] = [];
	let err = "";
	try {
		words = await generatePool(theme);
	} catch (e) {
		err = e instanceof ThemeError ? `ThemeError: ${e.message}` : `Error: ${(e as Error).message}`;
	}
	const ms = Date.now() - t;
	// The returned/valid ratio is for the last call (the one whose words we kept).
	const raw = real ? rawWords(replies.at(-1) ?? "") : words;
	const returned = raw.length;
	const rejected = raw.filter((w) => !words.includes(w));
	totalMs += ms;
	if (!err) {
		ok++;
		totalReturned += returned;
		totalValid += words.length;
	}
	console.log(`\n${theme}: ${ms} ms, calls ${real ? replies.length : 0}, returned ${returned}, valid ${words.length}${err ? `, ${err}` : ""}`);
	if (words.length) console.log(`  ${words.join(" ")}`);
	if (rejected.length) console.log(`  rejected: ${rejected.join(" ")}`);
}
console.log(`\n${real ? "REAL" : "MOCK"}: ${themes.length} themes, ${ok} ok, avg ${Math.round(totalMs / themes.length)} ms, ` +
	`validity ${totalReturned ? ((100 * totalValid) / totalReturned).toFixed(1) : "n/a"}% (${totalValid}/${totalReturned})`);
