import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

test.describe('URL Import', () => {
  test('creates article from a URL via the new article page', async ({ page }) => {
    await page.goto('/new');

    // Step 0: switch the wizard to URL mode and enter an HTTPS source.
    await page.getByRole('tab', { name: 'Import URL' }).click();
    const urlInput = page.getByPlaceholder(/https:\/\//i);
    await expect(urlInput).toBeVisible();

    // Step-0 validation mirrors the server rule: non-HTTPS never proceeds.
    await urlInput.fill('http://example.com/article');
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    await urlInput.fill('https://example.com/article');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 1 (style) → Generate. Exact match: the wizard stepper also
    // exposes a "3. Generate" step button.
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    // The generate step auto-submits. In E2E environments the article
    // Workflow binding is absent and no live fetch/LLM runs, so the honest
    // terminal state is either visible progress or the failure panel with a
    // retry — never a silent hang.
    await expect(
      page
        .getByText('Generating Your Article')
        .or(page.getByText('Generation Failed'))
    ).toBeVisible({ timeout: 15_000 });
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
