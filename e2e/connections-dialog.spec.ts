import { expect } from '@playwright/test';

import { authenticatedTest as test } from './fixtures/authenticated';

const viewports = [
  { name: 'folded phone', width: 280, height: 653 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const viewport of viewports) {
  test(`Connections dialog is usable on ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto('/workspace?settings=connections&source=e2e');

    const dialog = page.getByRole('dialog', { name: 'Connections' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close connections' })).toBeVisible();
    await expect(page.getByText('Browser publisher', { exact: true })).toBeVisible();
    await expect(page.locator('[data-connections-settings-content]')).toBeVisible();

    if (viewport.width >= 768) {
      await expect(page.locator('[data-connections-settings-rail]')).toBeVisible();
      const settingsNavigation = page.getByRole('navigation', { name: 'Settings sections' });
      await expect(settingsNavigation).toBeVisible();
      await expect(settingsNavigation.locator('[data-connections-settings-nav-item]'))
        .toHaveAttribute('aria-current', 'page');
    }

    const dimensions = await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        viewportWidth: window.innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false
    ))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/workspace\?source=e2e$/);

    if (viewport.width >= 768) {
      await expect(page.locator('[data-workspace-account-trigger]')).toBeFocused();
    }
    expect(consoleErrors).toEqual([]);
  });
}

test('legacy Connections URL opens the workspace dialog', async ({ page }) => {
  await page.goto('/settings/connections');

  await expect(page).toHaveURL(/\/workspace\?settings=connections$/);
  await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
});
