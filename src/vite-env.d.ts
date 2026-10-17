/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Optional game server origin; defaults to the page's own origin. */
	readonly VITE_SERVER_URL?: string;
}
