import { test, expect } from '@playwright/test';

test.describe('Access Gate', () => {
  test('redirects unauthenticated users to /access', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/access/);
  });

  test('shows access form on /access page', async ({ page }) => {
    await page.goto('/access');
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('rejects invalid access code', async ({ page }) => {
    await page.goto('/access');
    const input = page.getByPlaceholder(/access/i).or(page.getByRole('textbox'));
    if (await input.isVisible()) {
      await input.fill('invalid-code');
      await page.getByRole('button', { name: /enter|submit|access/i }).click();
      await expect(page.getByText(/invalid|incorrect|denied/i)).toBeVisible({ timeout: 5000 });
    }
  });
});
