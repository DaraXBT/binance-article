import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const deckFixture = {
  id: 'e2e-x-export',
  status: 'ready',
  title: 'E2E X export',
  slides: [{
    id: 'slide-1',
    deckId: 'e2e-x-export',
    title: 'Market setup',
    subtitle: null,
    bullets: [],
    bulletPoints: [],
    notes: null,
    imageUrl: 'https://example.invalid/slide-1.png',
    imageStatus: 'generated',
    imageError: null,
    imagePrompt: null,
    order: 0,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }],
  captions: { xSingle1: 'A generated X post.' },
};

test('downloads a reviewed X post bundle from the article studio', async ({ page }) => {
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
  await page.route('**/api/articles/e2e-x-export', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(deckFixture) });
  });
  await page.route('**/api/articles/e2e-x-export/assets/slide-1.png**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PIXEL_PNG });
  });

  await page.goto('/articles/e2e-x-export');
  await page.getByRole('button', { name: 'Prepare post for X' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare X post' })).toBeVisible();
  await expect(page.getByLabel('X post text')).toHaveValue('A generated X post.');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download X post bundle' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('E2E-X-export-x-post.zip');

  const archivePath = await download.path();
  expect(archivePath).toBeTruthy();
  const archive = await JSZip.loadAsync(await fs.readFile(archivePath!));
  expect(await archive.file('post.txt')?.async('string')).toBe('A generated X post.');
  expect(archive.file('manifest.json')).toBeTruthy();
  expect(archive.file('images/01-post.png')).toBeTruthy();
});
