import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // The project-local Binance skill owns its Bun/node:test suite. Keep it
    // out of the app's Vitest run (and avoid traversing its private install).
    exclude: ['e2e/**', 'node_modules/**', '.agents/**', 'publisher-companion/**'],
  },
});
