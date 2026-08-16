import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';
import { futurePublisherCommandExpiry } from './fixtures/publisher-command';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const deckFixture = {
  id: 'e2e-binance-export',
  status: 'ready',
  title: 'E2E Binance export',
  cover: {
    id: 'cover-1', generationRevision: 1, style: 'binance-master', styleMode: 'scene',
    prompt: 'text-free', status: 'generated',
    imageUrl: 'r2://article-assets/cover-asset/cover-source.png', error: null,
    createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
  },
  slides: [
    {
      id: 'slide-1',
      deckId: 'e2e-binance-export',
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
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    },
  ],
  captions: {
    blogTitle: 'E2E Binance title',
    blogIntro: 'An exportable introduction.',
    blogSections: ['The first section.'],
    blogTags: ['BTC', 'web 3'],
  },
};

test('prepares, reviews, and explicitly approves one Binance publish click', async ({ page }) => {
  const commandExpiresAt = futurePublisherCommandExpiry();
  let commandState = 'queued';
  await page.route('**/api/workspace', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasWorkspace: true,
        workspaceRole: 'owner',
        canReplaceWithLegacy: false,
        generateAccessEnabled: false,
        hasGenerationAccess: true,
        generationAccessInvalidReason: null,
      }),
    });
  });
  await page.route('**/api/articles/e2e-binance-export', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deckFixture) });
  });
  // Asset URLs are keyed by the stable assetId from the r2:// reference.
  await page.route('**/api/articles/e2e-binance-export/assets/slide-asset**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG });
  });
  await page.route('**/api/articles/e2e-binance-export/assets/cover-asset**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG });
  });
  await page.route(
    (url) => url.pathname === '/api/articles/e2e-binance-export/publications/binance',
    async (route) => {
      if (route.request().method() === 'GET') {
        expect(new URL(route.request().url()).searchParams.get('kind')).toBe('article');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: null }) });
        return;
      }
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ draft: { ...payload, id: 'draft-1', revision: 1, target: 'binance-square' } }),
      });
    },
  );
  await page.route(/\/api\/articles\/e2e-binance-export\/publications\/binance\/prepare$/, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        recipeHash: 'a'.repeat(64),
        command: {
          id: 'command-1', draftId: 'draft-1', target: 'binance-square', kind: 'article', state: 'queued',
          revision: 1, recipeHash: 'a'.repeat(64), expiresAt: commandExpiresAt,
        },
      }),
    });
    commandState = 'awaiting_review';
  });
  await page.route(/\/api\/publisher\/commands\/command-1$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ command: {
        id: 'command-1', draftId: 'draft-1', target: 'binance-square', kind: 'article', state: commandState,
        revision: 1, recipeHash: 'a'.repeat(64), expiresAt: commandExpiresAt,
        ...(commandState === 'succeeded'
          ? { publishedUrl: 'https://www.binance.com/en/square/post/123' }
          : {}),
      } }),
    });
  });
  await page.route(/\/api\/publisher\/commands\/command-1\/approve$/, async (route) => {
    commandState = 'succeeded';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ command: {
        id: 'command-1', draftId: 'draft-1', target: 'binance-square', kind: 'article', state: 'approved',
        revision: 1, recipeHash: 'a'.repeat(64), expiresAt: commandExpiresAt,
      } }),
    });
  });

  await page.goto('/articles/e2e-binance-export');
  await expect(page.getByRole('button', { name: 'Prepare in Binance' })).toBeVisible();
  await page.getByRole('button', { name: 'Prepare in Binance' }).click();
  await expect(page.getByRole('heading', { name: 'Export to Binance Square' })).toBeVisible();
  await expect(page.getByLabel('Article Markdown')).toHaveValue(/## Market setup/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Prepare in Binance' }).click();
  await expect(dialog.getByText(/Composer ready/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve one publish click' }).click();
  await expect(dialog.getByText('Published and verified.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /View published post/i }))
    .toHaveAttribute('href', 'https://www.binance.com/en/square/post/123');
});
