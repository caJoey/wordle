const GEMMA_API_URL =
	process.env.GEMMA_API_URL ||
	"https://generativelanguage.googleapis.com/v1beta/models/gemma-4:generateContent";

/** Server-side Gemma 4 integration point. Keep the API key out of frontend code. */
export async function generateThemeWords(theme: string): Promise<string[]> {
	if (!process.env.GEMMA_API_KEY) {
		// Keep local multiplayer usable before provider credentials are configured.
		return ["apple", "grape", "peach", "berry", "lemon"];
	}

	const response = await fetch(`${GEMMA_API_URL}?key=${process.env.GEMMA_API_KEY}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			contents: [
				{
					parts: [
						{
							text: `Return only a JSON array containing exactly 20 distinct common five-letter English words matching this theme: ${theme}.`,
						},
					],
				},
			],
		}),
	});

	if (!response.ok) {
		throw new Error(`Gemma request failed (${response.status})`);
	}

	const data = (await response.json()) as any;
	const generatedText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
	const jsonArray = generatedText.match(/\[[\s\S]*\]/)?.[0] || "[]";
	const parsedWords = JSON.parse(jsonArray);
	if (!Array.isArray(parsedWords)) {
		throw new Error("Gemma returned an invalid word list.");
	}

	const words = [
		...new Set(
			parsedWords
				.map((word) => String(word).toLowerCase())
				.filter((word) => /^[a-z]{5}$/.test(word)),
		),
	];
	if (words.length === 0) {
		throw new Error("Gemma returned no valid five-letter words.");
	}

	return words;
}
