# Themed Multiplayer Wordle

A multiplayer take on [Wordle](https://www.nytimes.com/games/wordle/). Up to 4 players join a lobby with a code, someone picks a theme ("animals", "the ocean", "music"...), and Google's Gemma model picks answer words that fit it. Everyone gets the same secret word and races to solve it in 6 guesses. You see your opponents' colors live (but not their letters), and the fastest solver wins the round.

## Setup

Requires Node 22.

```sh
npm i
echo GEMMA_API=your-gemini-api-key > .env   # key from https://aistudio.google.com/apikey
npm run dev
```

Then open the Vite URL it prints (http://localhost:5173). The game server runs on port 3001, and Vite proxies `/socket.io` to it.

`.env` is gitignored. The key is only read by the server and never reaches the browser.

### Mock mode (offline)

If `GEMMA_API` is not set, or `GEMMA_MOCK=1` is, the server never calls the API. Themes return a fixed word pool after about 300 ms: hand-picked words for common topics (animals, food, sports, music, weather, space), and a theme-seeded selection from the answer list for anything else. This makes the game fully playable and testable offline. `GEMMA_MOCK=0` forces real mode.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Game server (`tsx watch`) and Vite dev server together |
| `npm run server` | Game server only, with reload on change |
| `npm run build` | Build the client into `dist/` |
| `npm start` | Production: the server runs with `NODE_ENV=production` and serves `dist/` on `$PORT` (default 3001) |
| `npm test` | Unit tests (`tests/` and `server/test/`) with Node's built-in test runner |
| `npm run check` | `svelte-check` type checking |
| `npm run eval` | Run sample themes through the word generator. Uses mock mode unless you pass `-- --real` (real calls count against your quota) |

## Deploying

Socket.IO needs a long-running Node process, so this can't be hosted on GitHub Pages. Any host that runs Docker will work (Render, Fly.io, Railway...):

```sh
docker build -t themed-wordle .
docker run -p 3001:3001 -e GEMMA_API=your-key themed-wordle
```

The image builds the client, then runs the server with `NODE_ENV=production`. It listens on `$PORT`, which most hosts set for you. Set `GEMMA_API` as a secret in the host's environment settings. Health checks can use `GET /healthz`. Lobbies are kept in memory, so run a single instance.

The Gemini API free tier allows 16,000 input tokens per minute for Gemma, and each theme request sends about 2,900 tokens (the whole answer list). That's roughly 5 theme generations per minute, shared across all lobbies.

CI (`.github/workflows/ci.yml`) runs install, check, test and build on pushes and PRs to `main`.

## Architecture

- `shared/`: code used by both sides: the Socket.IO event contract (`protocol.ts`), guess scoring and validation (`wordle.ts`), and the word lists (2,315 answer words, 10,657 more valid guesses).
- `server/`: Express + Socket.IO. It holds lobbies in memory, runs rounds and timers, and scores every guess on the server, so clients never see the answer before the round ends.
- `server/words/gemma.ts`: sends the theme and the answer list to `gemma-4-26b-a4b-it` (thinking set to minimal, JSON output). It keeps only words from the answer list and drops answers already used in the lobby. If fewer than 5 words come back, it retries once with stricter wording, then asks the players for a broader theme.
- `src/`: the Svelte client (lobby, theme picking, boards, results), built with Vite.

## License

GPL-3.0. Forked from [MikhaD/wordle](https://github.com/MikhaD/wordle), the single-player Wordle+ by MikhaD. Many thanks to the original project. Forks must follow the same license.
