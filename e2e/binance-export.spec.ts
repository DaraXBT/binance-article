import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const deckFixture = {
  id: 'e2e-binance-export',
  status: 'ready',
  title: 'E2E Binance export',
  slides: [
    {
      id: 'slide-1',
      deckId: 'e2e-binance-export',
      title: 'Market setup',
      subtitle: null,
      bullets: [],
      bulletPoints: [],
      notes: null,
      imageUrl: 'https://example.public.blob.vercel-storage.com/slide-1.png',
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

test('downloads a reviewed Binance bundle from the article studio', async ({ page }) => {
  test.skip(
    process.env.E2E_AUTHENTICATED !== '1',
    'Set E2E_AUTHENTICATED=1 and E2E_STORAGE_STATE to a private test-account session.',
  );
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
  await page.route('**/api/articles/e2e-binance-export', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deckFixture) });
  });
  await page.route('**/api/articles/e2e-binance-export/assets/slide-1.png**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG });
  });

  await page.goto('/articles/e2e-binance-export');
  await expect(page.getByRole('button', { name: /Binance Square/i })).toBeVisible();
  await page.getByRole('button', { name: /Binance Square/i }).click();
  await expect(page.getByRole('heading', { name: 'Export to Binance Square' })).toBeVisible();
  await expect(page.getByLabel('Article Markdown')).toHaveValue(/## Market setup/);
  await expect(page.getByLabel('Use Market setup as cover')).toBeChecked();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Binance bundle' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('E2E-Binance-title-binance-square.zip');

  const archivePath = await download.path();
  expect(archivePath).toBeTruthy();
  const archive = await JSZip.loadAsync(await fs.readFile(archivePath!));
  expect(await archive.file('article.md')?.async('string')).toContain('## Market setup');
  expect(archive.file('manifest.json')).toBeTruthy();
  expect(archive.file('images/cover.jpg')).toBeTruthy();
  expect(archive.file('images/01-slide.png')).toBeTruthy();
});
