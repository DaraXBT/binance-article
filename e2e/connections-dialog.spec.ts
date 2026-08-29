import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

const viewports = [
  { name: 'folded phone', width: 280, height: 653 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'reported desktop', width: 1366, height: 733 },
] as const;

for (const viewport of viewports) {
  test(`Account settings is usable on ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto('/workspace?settings=connections&source=e2e');

    const dialog = page.getByRole('dialog', { name: 'Account settings' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close account settings' })).toBeVisible();
    await expect(page.locator('[data-connections-settings-content]')).toBeVisible();

    const settingsNavigation = page.getByRole('tablist', { name: 'Settings sections' });
    const aiTab = settingsNavigation.getByRole('tab', { name: 'AI & generation' });
    const publishingTab = settingsNavigation.getByRole('tab', { name: 'Publishing' });
    await expect(settingsNavigation).toBeVisible();
    await expect(aiTab).toHaveAttribute('aria-selected', 'true');
    await expect(publishingTab).toBeVisible();
    await expect(page.getByText('Connections', { exact: true })).toHaveCount(0);

    const readDimensions = () => dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        borderRadius: style.borderRadius,
        className: element.className,
      };
    });
    const dimensions = await readDimensions();
    expect(dimensions.top).toBeGreaterThan(0);
    expect(dimensions.bottom).toBeLessThan(dimensions.viewportHeight);
    expect(dimensions.left).toBeGreaterThan(0);
    expect(dimensions.right).toBeLessThan(dimensions.viewportWidth);
    expect(dimensions.width).toBeLessThan(dimensions.viewportWidth);
    expect(dimensions.height).toBeLessThan(dimensions.viewportHeight);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    expect(dimensions.borderRadius).not.toBe('0px');
    expect(dimensions.className).toContain('rounded-xl');
    expect(dimensions.className).not.toContain('!inset-0');
    await expect(dialog.locator('[data-frame-corner]')).toHaveCount(0);

    if (viewport.width < 768) {
      const mobileTabTargets = await Promise.all(
        [aiTab, publishingTab].map((tab) => tab.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { height: box.height, width: box.width };
        })),
      );
      for (const target of mobileTabTargets) {
        expect(target.height).toBeGreaterThanOrEqual(43.5);
        expect(target.width).toBeGreaterThanOrEqual(43.5);
      }
    } else {
      const desktopTabHeights = await Promise.all(
        [aiTab, publishingTab].map((tab) => tab.evaluate((element) => (
          element.getBoundingClientRect().height
        ))),
      );
      for (const height of desktopTabHeights) {
        expect(height).toBeGreaterThanOrEqual(43.5);
        expect(height).toBeLessThanOrEqual(56);
      }
    }

    await publishingTab.click();
    await expect(publishingTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Browser publisher', { exact: true })).toBeVisible();

    await publishingTab.press('ArrowLeft');
    await expect(aiTab).toHaveAttribute('aria-selected', 'true');
    await expect(aiTab).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/workspace\?source=e2e$/);

    if (viewport.width >= 768) {
      await expect(page.locator('[data-workspace-account-trigger]')).toBeFocused();
    }
    expect(consoleErrors).toEqual([]);
  });
}

test('legacy Connections URL opens Account settings', async ({ page }) => {
  await page.goto('/settings/connections');

  await expect(page).toHaveURL(/\/workspace\?settings=connections$/);
  await expect(page.getByRole('dialog', { name: 'Account settings' })).toBeVisible();
});
