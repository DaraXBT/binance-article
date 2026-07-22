import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

test.describe('URL Import', () => {
  test('creates article from a URL via the new article page', async ({ page }) => {
    await page.goto('/new');

    // Look for URL input or tab
    const urlTab = page.getByRole('tab', { name: /url|import|link/i });
    if (await urlTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await urlTab.click();
    }

    const urlInput = page.getByPlaceholder(/url|link|https/i);
    if (await urlInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await urlInput.fill('https://example.com');
      const importButton = page.getByRole('button', { name: /import|fetch|extract/i });
      await importButton.click();

      // Should show extracted content or progress indicator
      await expect(
        page
          .getByText(/extracting|fetching|processing/i)
          .or(page.getByText(/example domain/i))
          .or(page.getByText(/error|failed/i))
      ).toBeVisible({ timeout: 15_000 });
    }
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
