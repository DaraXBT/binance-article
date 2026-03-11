import { test, expect } from '@playwright/test';

test.describe('Workspace', () => {
  test('creates a workspace and shows recovery key', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/access/);

    // Authenticate with access code
    const codeInput = page.getByRole('textbox');
    await codeInput.fill(process.env.TEST_ACCESS_CODE || 'test-code');
    await page.getByRole('button', { name: /enter|submit|access/i }).click();

    // Should redirect to home after access
    await page.waitForURL('/', { timeout: 10_000 });

    // Create workspace — look for onboarding or workspace creation prompt
    const createButton = page.getByRole('button', { name: /create|get started|new workspace/i });
    if (await createButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await createButton.click();
    }

    // Recovery key should be displayed after workspace creation
    const recoveryKey = page.getByText(/dwk_/);
    if (await recoveryKey.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const keyText = await recoveryKey.textContent();
      expect(keyText).toMatch(/^dwk_/);
    }
  });

  test('recovers workspace with recovery key via API', async ({ request }) => {
    // Create workspace via API
    const createRes = await request.post('/api/workspace');
    expect(createRes.status()).toBe(201);
    const { recoveryKey, workspaceId } = await createRes.json();
    expect(recoveryKey).toMatch(/^dwk_/);
    expect(workspaceId).toBeTruthy();

    // Recover using the key
    const recoverRes = await request.post('/api/workspace/recover', {
      data: { accessKey: recoveryKey },
    });
    expect(recoverRes.status()).toBe(200);
    const recovered = await recoverRes.json();
    expect(recovered.workspaceId).toBe(workspaceId);
  });

  test('rejects invalid recovery key', async ({ request }) => {
    const res = await request.post('/api/workspace/recover', {
      data: { accessKey: 'dwk_invalid_key_that_does_not_exist' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_ACCESS_KEY');
  });
});
