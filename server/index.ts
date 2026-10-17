import { createServer } from "./app";

try {
	process.loadEnvFile();
} catch {
	// No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT) || 3001;
const server = createServer();
server.listen(PORT).then((port) => {
	console.log(`Game server listening on http://localhost:${port}${process.env.NODE_ENV === "production" ? " (serving dist/)" : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		server.close().finally(() => process.exit(0));
	});
}
