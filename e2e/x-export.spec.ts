import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';
import { futurePublisherCommandExpiry } from './fixtures/publisher-command';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const deckFixture = {
  id: 'e2e-x-export',
  status: 'ready',
  title: 'E2E X export',
  cover: null,
  slides: [{
    id: 'slide-1',
    deckId: 'e2e-x-export',
    title: 'Market setup',
    subtitle: null,
    bullets: [],
    bulletPoints: [],
    notes: null,
    imageUrl: 'r2://article-assets/slide-asset/slide-1.png',
    imageStatus: 'generated',
    imageError: null,
    imagePrompt: null,
    order: 0,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }],
  captions: { xSingle1: 'A generated X post.' },
};

test('prepares, reviews, and explicitly approves one regular X post click', async ({ page }) => {
  const commandExpiresAt = futurePublisherCommandExpiry();
  let commandState = 'queued';
  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasWorkspace: true,
        workspaceId: 'workspace-e2e',
        accessKeyPrefix: 'dwk_e2e',
        recoveryKey: null,
        generateAccessEnabled: false,
        hasGenerationAccess: true,
        generationAccessInvalidReason: null,
      }),
    });
  });
  await page.route('**/api/articles/e2e-x-export', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deckFixture) });
  });
  await page.route('**/api/articles/e2e-x-export/assets/slide-1.png**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG });
  });
  await page.route(/\/api\/articles\/e2e-x-export\/publications\/x$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: null }) });
      return;
    }
    const payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ draft: { ...payload, id: 'draft-x', revision: 1, target: 'x' } }),
    });
  });
  await page.route(/\/api\/articles\/e2e-x-export\/publications\/x\/prepare$/, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        recipeHash: 'b'.repeat(64),
        command: {
          id: 'command-x', draftId: 'draft-x', target: 'x', state: 'queued', revision: 1,
          recipeHash: 'b'.repeat(64), expiresAt: commandExpiresAt,
        },
      }),
    });
    commandState = 'awaiting_review';
  });
  await page.route(/\/api\/publisher\/commands\/command-x$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ command: {
        id: 'command-x', draftId: 'draft-x', target: 'x', state: commandState, revision: 1,
        recipeHash: 'b'.repeat(64), expiresAt: commandExpiresAt,
        ...(commandState === 'succeeded'
          ? { publishedUrl: 'https://x.com/xarticle/status/1234567890' }
          : {}),
      } }),
    });
  });
  await page.route(/\/api\/publisher\/commands\/command-x\/approve$/, async (route) => {
    commandState = 'succeeded';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ command: {
        id: 'command-x', draftId: 'draft-x', target: 'x', state: 'approved', revision: 1,
        recipeHash: 'b'.repeat(64), expiresAt: commandExpiresAt,
      } }),
    });
  });

  await page.goto('/articles/e2e-x-export');
  await page.getByRole('button', { name: 'Prepare on X' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare X post' })).toBeVisible();
  await expect(page.getByLabel('X post text')).toHaveValue('A generated X post.');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Prepare on X' }).click();
  await expect(dialog.getByText(/Composer ready/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve one publish click' }).click();
  await expect(dialog.getByText('Published and verified.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /View published post/i }))
    .toHaveAttribute('href', 'https://x.com/xarticle/status/1234567890');
});
