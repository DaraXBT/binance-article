import { expect, test, type Locator, type Page } from '@playwright/test';

import { E2E_BASE_URL } from './fixtures/base-url';

const viewports = [
  { name: 'folded-phone', width: 280, height: 653 },
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'phone-landscape', width: 667, height: 375 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'small-laptop', width: 1024, height: 600 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide-desktop', width: 1920, height: 1080 },
] as const;

function collectBrowserFailures(page: Page) {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(response.status() + ' ' + response.url());
  });

  return { consoleErrors, failedResponses };
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.rootScrollWidth).toBeLessThanOrEqual(dimensions.rootClientWidth + 1);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
}

async function expectInsideViewport(locator: Locator, viewportWidth: number) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const currentBox = await locator.boundingBox();
    if (!currentBox) return false;
    return currentBox.x >= -1 && currentBox.x + currentBox.width <= viewportWidth + 1;
  }).toBe(true);
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(-1);
  expect((box?.x ?? viewportWidth) + (box?.width ?? 1)).toBeLessThanOrEqual(viewportWidth + 1);
}

async function expectVerticallyReachable(locator: Locator, viewportHeight: number) {
  await locator.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return false;
    return box.y < viewportHeight && box.y + box.height > 0;
  }).toBe(true);
}

test.beforeEach(async ({ context, page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'light');
  });
});

for (const viewport of viewports) {
  test('public surfaces fit ' + viewport.name, async ({ page }) => {
    const failures = collectBrowserFailures(page);
    await page.setViewportSize(viewport);

    await page.goto('/');
    const composer = page.locator('[data-article-studio-composer]');
    await expectInsideViewport(composer, viewport.width);
    await expectVerticallyReachable(composer, viewport.height);
    await expectNoHorizontalOverflow(page);

    if (viewport.width < 768) {
      const sidebarTrigger = page.locator('[data-article-studio-sidebar-trigger]');
      await expectInsideViewport(sidebarTrigger, viewport.width);
      await sidebarTrigger.click();
      const mobileSidebar = page.locator('[data-mobile="true"]');
      await expectInsideViewport(mobileSidebar, viewport.width);
      await page.keyboard.press('Escape');
    }

    await page.goto('/login');
    await expectInsideViewport(page.locator('[data-auth-panel="login"]'), viewport.width);
    await expectNoHorizontalOverflow(page);

    await page.goto('/join');
    await expectInsideViewport(page.locator('[data-auth-panel="join"]'), viewport.width);
    await expectNoHorizontalOverflow(page);

    expect(failures.consoleErrors).toEqual([]);
    expect(failures.failedResponses).toEqual([]);
  });
}

test('stale non-English preferences cannot change the English UI', async ({ context, page }) => {
  await page.setViewportSize(viewports[0]);
  await context.addCookies([{
    name: 'deckforge_language',
    value: 'km',
    url: E2E_BASE_URL,
  }]);
  await page.addInitScript(() => {
    window.localStorage.setItem('deckforge_language', 'km');
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'What do you want to write about?' })).toBeVisible();
  await expect(page.locator('[data-language-toggle]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('deckforge_language')))
    .toBe('en');
  await expectNoHorizontalOverflow(page);
});

test('prompt typing has no pointer focus halo and keeps keyboard focus visible', async ({ page }) => {
  await page.goto('/');
  const prompt = page.locator('.studio-prompt-input');
  const promptBox = page.locator('[data-slot="ai-prompt-box"]');

  await prompt.click();
  await expect(promptBox).not.toHaveAttribute('data-focus-visible', 'true');
  await expect.poll(() => prompt.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      hasNonZeroShadow: /(?:^|\s)-?(?:[1-9]\d*|0\.\d*[1-9]\d*)px/.test(style.boxShadow),
      outlineStyle: style.outlineStyle,
    };
  })).toEqual({ hasNonZeroShadow: false, outlineStyle: 'none' });

  await prompt.evaluate((element) => element.blur());
  await page.keyboard.press('Tab');
  await prompt.focus();
  await expect(promptBox).toHaveAttribute('data-focus-visible', 'true');
  await expect(promptBox).toHaveClass(/ring-\[3px\]/);
});
