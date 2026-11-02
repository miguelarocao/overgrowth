import { defineConfig } from 'vite';

// The client lives in client/, the server in server/. In dev, Vite proxies the
// WebSocket and replay API to the game server on port 8787.
export default defineConfig({
  root: 'client',
  build: { outDir: '../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' }
    }
  },
  test: { root: '.', include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'bots/**/*.test.ts', 'client/src/**/*.test.ts'] }
} as any);
