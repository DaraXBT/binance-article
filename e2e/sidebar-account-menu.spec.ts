import { expect, type Locator } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';
import { E2E_BASE_URL } from './fixtures/base-url';

type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

async function boundsOf(locator: Locator): Promise<Bounds> {
  return locator.evaluate((element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  });
}

test('keeps the account control pinned and adapts its menu around the desktop rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workspace');

  const accountTrigger = page.locator('[data-workspace-account-trigger]');
  const accountMenu = page.locator('[data-workspace-profile-popover="true"]');
  const rail = page.locator('[data-slot="sidebar-container"][data-article-studio-rail="workspace"]');

  await expect(accountTrigger).toBeVisible();
  await expect(rail).toBeVisible();

  await accountTrigger.click();
  await expect(accountMenu).toBeVisible();

  await expect.poll(async () => {
    const [triggerBounds, menuBounds] = await Promise.all([
      boundsOf(accountTrigger),
      boundsOf(accountMenu),
    ]);
    return Math.abs(menuBounds.width - triggerBounds.width) <= 2;
  }).toBe(true);
  const expandedTrigger = await boundsOf(accountTrigger);
  const expandedMenu = await boundsOf(accountMenu);
  expect(expandedMenu.bottom).toBeLessThanOrEqual(expandedTrigger.top);

  await accountTrigger.click();
  await expect(accountMenu).toBeHidden();

  await page.locator('[data-studio-sidebar-brand-toggle]').click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
  await expect.poll(async () => (await boundsOf(rail)).width).toBeLessThanOrEqual(50);
  await expect(accountTrigger).toBeVisible();

  const collapsedTrigger = await boundsOf(accountTrigger);
  const collapsedRail = await boundsOf(rail);
  expect(collapsedTrigger.bottom).toBeGreaterThanOrEqual(collapsedRail.bottom - 16);

  await accountTrigger.click();
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu).toHaveAttribute('data-side', 'right');

  await expect.poll(async () => {
    const [menuBounds, railBounds] = await Promise.all([
      boundsOf(accountMenu),
      boundsOf(rail),
    ]);
    return menuBounds.left - railBounds.right;
  }).toBeGreaterThanOrEqual(4);

  const collapsedMenu = await boundsOf(accountMenu);
  expect(collapsedMenu.left).toBeGreaterThanOrEqual(0);
  expect(collapsedMenu.right).toBeLessThanOrEqual(1280);
});

test('switches the workspace language immediately and keeps it after reload', async ({ context, page }) => {
  await context.addCookies([{
    name: 'xarticle_language',
    value: 'en',
    url: E2E_BASE_URL,
  }]);
  await page.addInitScript(() => {
    window.localStorage.setItem('xarticle_language', 'en');
  });
  await page.goto('/workspace');

  const heading = page.locator('[data-workspace-home] h1');
  await expect(heading).toBeVisible();
  const englishHeading = await heading.textContent();
  expect(englishHeading).toBeTruthy();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.locator('[data-workspace-account-trigger]').click();
  const languageMenuTrigger = page.locator('[data-language-menu-trigger]');
  await expect(languageMenuTrigger).toBeVisible();
  await languageMenuTrigger.click();
  await page.locator('[data-language-option="km"]').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect.poll(() => heading.textContent()).not.toBe(englishHeading);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('xarticle_language')))
    .toBe('km');
  expect(page.url()).toContain('/workspace');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  await expect(heading).toHaveText('តើអ្នកចង់សរសេរអំពីអ្វី?');
});
