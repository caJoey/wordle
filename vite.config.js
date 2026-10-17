import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { version } from "./package.json";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  server: {
    // The game server (npm run server) runs separately on port 3001
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
  plugins: [svelte({
    preprocess: vitePreprocess()
  })],
  build: {
    rollupOptions: {
      output: {
        assetFileNames: `[name]-v${version}.[ext]`,
        entryFileNames: `[name]-v${version}.js`,
        dir: "./dist",
      }
    }
  }
});
