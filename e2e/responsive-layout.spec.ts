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
    const main = page.locator('[data-article-studio-main]');
    const shell = page.locator('[data-studio-surface="public"] > .console-shell');
    await expectInsideViewport(composer, viewport.width);
    await expectVerticallyReachable(composer, viewport.height);
    await expectNoHorizontalOverflow(page);
    await expect.poll(async () => main.evaluate((element) => window.getComputedStyle(element).paddingTop))
      .toBe('0px');
    await expect.poll(async () => shell.evaluate((element) => element.getBoundingClientRect().top))
      .toBe(0);

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
    const headingTop = await heading.evaluate((element) => element.getBoundingClientRect().top);
    expect(headingTop).toBeLessThanOrEqual(viewport.width < 768 ? 96 : 56);

    if (viewport.width < 768) {
      const sidebarTrigger = page.locator('[data-article-studio-sidebar-trigger]');
      await expectInsideViewport(sidebarTrigger, viewport.width);
      const [triggerBox, headingBox] = await Promise.all([
        sidebarTrigger.boundingBox(),
        heading.boundingBox(),
      ]);
      expect(triggerBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect((triggerBox?.y ?? viewport.height) + (triggerBox?.height ?? 0))
        .toBeLessThanOrEqual(headingBox?.y ?? 0);
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

test('a saved locale initializes server-rendered public UI and clears legacy preference', async ({ context, page }) => {
  await page.setViewportSize(viewports[0]);
  await context.addCookies([
    {
      name: 'xarticle_language',
      value: 'km',
      url: E2E_BASE_URL,
    },
    {
      name: 'deckforge_language',
      value: 'en',
      url: E2E_BASE_URL,
    },
  ]);
  await page.addInitScript(() => {
    // Cloudflare injects a same-origin helper iframe in production. Only the
    // top-level document represents the browser preference under test.
    if (window.top !== window) return;
    window.localStorage.setItem('xarticle_language', 'en');
    window.localStorage.setItem('deckforge_language', 'en');
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect(page).toHaveTitle('xArticle — ស្ទូឌីយោអត្ថបទ Binance Square');
  await expect(page.getByRole('heading', { name: 'តើអ្នកចង់សរសេរអំពីអ្វី?' })).toBeVisible();
  await page.getByRole('combobox', { name: 'ស្ទាយ៍' }).click();
  await expect(
    page.locator('[data-slot="select-content"]').getByText('Binance គ្រប់យ៉ាងក្នុងមួយ'),
  ).toBeVisible();
  await expect(page.locator('[data-language-toggle]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('xarticle_language')))
    .toBe('km');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('deckforge_language')))
    .toBeNull();
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
