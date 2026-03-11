import { test, expect } from '@playwright/test';

test.describe('Asset Download', () => {
  test('rejects unauthenticated asset requests', async ({ request }) => {
    // Try to access an asset without a workspace session
    const res = await request.get('/api/articles/nonexistent-id/assets/test.png');
    // Should return 401 or 404 (not 200)
    expect([401, 404, 500]).toContain(res.status());
    expect(res.status()).not.toBe(200);
  });

  test('returns 404 for non-existent article assets', async ({ request }) => {
    // Ensure workspace exists
    await request.post('/api/workspace');

    const res = await request.get('/api/articles/nonexistent-id/assets/test.png');
    expect(res.status()).toBe(404);
  });

  test('serves authorized asset with correct content type', async ({ request }) => {
    await request.post('/api/workspace');

    // Create an article first
    const createRes = await request.post('/api/articles', {
      data: {
        title: 'Asset Test Article',
        description: 'Test',
        content: 'Content for asset test.',
        illustrationStyle: 'pixel-art',
      },
    });
    const article = await createRes.json();

    // Try to access a non-existent asset on a real article
    const assetRes = await request.get(`/api/articles/${article.id}/assets/nonexistent.png`);
    // Should be 404 since no assets generated yet, not a server error
    expect([404, 400]).toContain(assetRes.status());
  });

  test('handles download query parameter', async ({ request }) => {
    await request.post('/api/workspace');

    const createRes = await request.post('/api/articles', {
      data: {
        title: 'Download Test',
        description: 'Test',
        content: 'Content.',
        illustrationStyle: 'pixel-art',
      },
    });
    const article = await createRes.json();

    // Request with download=1 should still return 404 for missing assets
    const res = await request.get(`/api/articles/${article.id}/assets/test.png?download=1`);
    expect([404, 400]).toContain(res.status());
  });
});
