// Production start, cross-platform: sets NODE_ENV=production (unless already set) and runs the
// TypeScript server through tsx. The server then serves the built client from dist/ on $PORT.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
	stdio: "inherit",
	env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "production" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
