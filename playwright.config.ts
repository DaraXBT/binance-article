import { defineConfig } from '@playwright/test';

const configuredBaseURL = process.env.BASE_URL?.trim();
const localBaseURL = 'http://127.0.0.1:3100';
const baseURL = configuredBaseURL || localBaseURL;

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: configuredBaseURL
    ? undefined
    : {
        command: 'NEXT_DIST_DIR=.next-playwright npm run dev -- --hostname 127.0.0.1 --port 3100',
        url: localBaseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
