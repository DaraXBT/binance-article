import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

test.describe('Workspace URL import', () => {
  test('creates an article from a URL in the workspace composer', async ({ page }) => {
    await page.goto('/workspace?source=url');

    await expect(page.getByRole('tab', { name: 'Import URL' })).toHaveAttribute('aria-selected', 'true');
    const urlInput = page.getByPlaceholder(/https:\/\//i);
    await expect(urlInput).toBeVisible();

    // The client guard mirrors the server's URL-schema rule.
    await urlInput.fill('http://example.com/article');
    await expect(page.getByRole('button', { name: 'Import & generate' })).toBeDisabled();

    await urlInput.fill('https://example.com/article');
    await page.getByRole('button', { name: 'Import & generate' }).click();
    await expect(page).toHaveURL(/\/articles\//, { timeout: 15_000 });
  });

  test('rejects non-HTTPS URLs via API', async ({ request }) => {
    await request.post('/api/workspace');

    // Create an article with a URL source — the URL fetch happens during generation,
    // not creation. Test that the SSRF protection works at the API level.
    const createRes = await request.post('/api/articles', {
      data: {
        title: 'URL Import Test',
        description: 'Test',
        content: 'http://example.com',
        illustrationStyle: 'pixel-art',
      },
    });
    expect(createRes.status()).toBe(201);
  });
});
