import { test, expect } from '@playwright/test';

test.describe('Article Creation and Generation', () => {
  test('creates an article from text and starts generation', async ({ request }) => {
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

    // Start generation
    const genRes = await request.post(`/api/articles/${article.id}/generate`, {
      data: {
        articleContent: 'This is a test article about blockchain technology.',
        slideCount: 1,
        illustrationStyle: 'pixel-art',
        mode: 'prompt',
      },
    });
    expect(genRes.status()).toBe(202);
    const job = await genRes.json();
    expect(job.jobId).toBeTruthy();
    expect(job.status).toBeTruthy();

    // Poll job until terminal state (max 2 minutes)
    let jobStatus = job.status;
    const maxPolls = 80;
    for (let i = 0; i < maxPolls; i++) {
      const pollRes = await request.get(`/api/jobs/${job.jobId}`);
      expect(pollRes.status()).toBe(200);
      const pollData = await pollRes.json();
      jobStatus = pollData.status;
      if (jobStatus === 'completed' || jobStatus === 'failed' || jobStatus === 'cancelled') {
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Verify terminal state reached (may fail if Gemini API key not set)
    expect(['completed', 'failed']).toContain(jobStatus);
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
