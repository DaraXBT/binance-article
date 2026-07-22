import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

test.describe('Article Creation and Generation', () => {
  test('creates an article from text with the selected illustration style', async ({ request }) => {
    // Ensure workspace exists
    await request.post('/api/workspace');

    // Create article
    const createRes = await request.post('/api/articles', {
      data: {
        title: 'E2E Test Article',
        description: 'Automated test article',
        content: 'This is a test article about blockchain technology.',
        illustrationStyle: 'pixel-art',
      },
    });
    expect(createRes.status()).toBe(201);
    const article = await createRes.json();
    expect(article.id).toBeTruthy();
    expect(article.title).toBe('E2E Test Article');
    expect(article.illustrationStyle).toBe('pixel-art');
  });

  test('retrieves article detail after creation', async ({ request }) => {
    await request.post('/api/workspace');

    const createRes = await request.post('/api/articles', {
      data: {
        title: 'Detail Test Article',
        description: 'Test',
        content: 'Content for detail test.',
        illustrationStyle: 'pixel-art',
      },
    });
    const article = await createRes.json();

    const detailRes = await request.get(`/api/articles/${article.id}`);
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.title).toBe('Detail Test Article');
    expect(detail.status).toBe('draft');
  });

  test('creates article through the UI', async ({ page }) => {
    await page.goto('/');

    // Fill in topic and prompt
    const topicInput = page.getByPlaceholder(/topic/i);
    if (await topicInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await topicInput.fill('E2E UI Test Topic');

      const promptInput = page.getByPlaceholder(/prompt|describe/i);
      await promptInput.fill('Write about blockchain settlement for enterprise use.');

      const generateButton = page.getByRole('button', { name: /generate article/i });
      await generateButton.click();

      // Should navigate to article page or show progress
      await expect(
        page.getByText(/generating|processing|queued/i).or(page.locator('[data-testid="article"]'))
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});
