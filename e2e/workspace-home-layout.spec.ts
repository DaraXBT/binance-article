import { expect, type Locator } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

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

test('keeps the signed-in composer top-aligned on mobile and centered in the desktop writing pane', async ({ page }) => {
  const home = page.locator('[data-workspace-home]');
  const heading = home.getByRole('heading', { level: 1 });
  const composer = home.locator('[data-article-studio-composer]');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/workspace');

  await expect(home).toBeVisible();
  await expect(heading).toHaveCount(1);
  await expect(home.getByRole('textbox')).toHaveCount(1);
  await expect(home.getByRole('combobox')).toHaveCount(2);
  await expect.poll(() => home.evaluate((element) => window.getComputedStyle(element).justifyContent))
    .toBe('flex-start');

  const [triggerBounds, headingBounds, composerBounds] = await Promise.all([
    boundsOf(page.locator('[data-article-studio-sidebar-trigger]')),
    boundsOf(heading),
    boundsOf(composer),
  ]);
  expect(triggerBounds.bottom).toBeLessThanOrEqual(headingBounds.top);
  expect(Math.abs((composerBounds.left + composerBounds.right) / 2 - 187.5)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/workspace');

  await expect(home).toBeVisible();
  await expect.poll(() => home.evaluate((element) => window.getComputedStyle(element).justifyContent))
    .toBe('center');

  const [homeBounds, desktopHeadingBounds, desktopComposerBounds] = await Promise.all([
    boundsOf(home),
    boundsOf(heading),
    boundsOf(composer),
  ]);
  const homeCenterX = (homeBounds.left + homeBounds.right) / 2;
  const composerCenterX = (desktopComposerBounds.left + desktopComposerBounds.right) / 2;
  const groupTop = desktopHeadingBounds.top;
  const groupBottom = desktopComposerBounds.bottom;
  const groupCenterY = (groupTop + groupBottom) / 2;
  const homeCenterY = (homeBounds.top + homeBounds.bottom) / 2;

  expect(Math.abs(composerCenterX - homeCenterX)).toBeLessThanOrEqual(1);
  expect(Math.abs(groupCenterY - homeCenterY)).toBeLessThanOrEqual(24);
});
