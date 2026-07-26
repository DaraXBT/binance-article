import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Extend (never replace) Vitest's defaults so dist/, cache dirs, etc.
    // stay excluded. The project-local skills own their Bun/node:test
    // suites; keep them out of the app's Vitest run.
    exclude: [...configDefaults.exclude, 'e2e/**', '.agents/**', 'publisher-companion/**'],
  },
});
