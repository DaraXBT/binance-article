import { expect } from '@playwright/test';

import { authConfiguredTest as test } from './fixtures/authenticated';
import { E2E_BASE_URL } from './fixtures/base-url';

test.describe('Account workspace security', () => {
  test('redirects a logged-out private page to Google login', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: undefined });
    try {
      const page = await context.newPage();
      await page.goto(`${baseURL ?? E2E_BASE_URL}/workspace`);
      await expect(page).toHaveURL(/\/login\?callbackURL=/);
      await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('rejects logged-out workspace creation and legacy claims', async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({
      baseURL: baseURL ?? E2E_BASE_URL,
    });
    try {
      const createResponse = await request.post('/api/workspace');
      expect(createResponse.status()).toBe(401);

      const claimResponse = await request.post('/api/workspace/recover', {
        data: { accessKey: `dwk_${'a'.repeat(36)}` },
      });
      expect(claimResponse.status()).toBe(401);
    } finally {
      await request.dispose();
    }
  });
});
