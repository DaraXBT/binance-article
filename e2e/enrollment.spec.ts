import { neon } from '@neondatabase/serverless';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { resetE2eEnrollmentState } from '../scripts/e2e-enrollment-cleanup';
import { authenticatedTest as test } from './fixtures/authenticated';

type CodeResponse = {
  code: string;
  joinUrl: string;
  version: number;
  revokedClaims?: number;
};

type DisableResponse = {
  disabled: boolean;
  changed: boolean;
  revokedClaims: number;
};

async function openEnrollmentLink(
  browser: Browser,
  joinUrl: string,
  expectedStatus: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const claimResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/enrollment/claim'
  ));
  await page.goto(joinUrl);
  expect((await claimResponse).status()).toBe(expectedStatus);
  await expect(page).not.toHaveURL(/#code=/);
  return { context, page };
}

test('owner can create, rotate, and disable a reusable enrollment code', async ({ browser, page }) => {
  test.skip(
    process.env.E2E_SEED_AUTH !== '1' || process.env.E2E_ENROLLMENT_MUTATIONS !== '1',
    'Enrollment lifecycle E2E requires explicit disposable-database opt-in.',
  );
  const target = new URL(process.env.BASE_URL?.trim() || 'http://127.0.0.1:3100');
  test.skip(
    !['localhost', '127.0.0.1', '::1'].includes(target.hostname),
    'Enrollment lifecycle E2E is restricted to the local server backed by the disposable database.',
  );
  // Playwright retries do not rerun globalSetup, so make each attempt isolated.
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required for enrollment E2E cleanup.');
  await resetE2eEnrollmentState({
    environment: process.env,
    sql: neon(databaseUrl),
  });
  await page.goto('/workspace?settings=connections&source=e2e-enrollment');
  await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
  const codePanel = page.locator('section[aria-labelledby="enrollment-code-title"]');
  await expect(codePanel.getByText('No active code. Create one before sharing access.')).toBeVisible();

  const createResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/admin/enrollment/code'
  ));
  await codePanel.getByRole('button', { name: 'Create code' }).click();
  const createdHttpResponse = await createResponse;
  expect(createdHttpResponse.status()).toBe(201);
  const created = await createdHttpResponse.json() as CodeResponse;
  expect(created.joinUrl).toContain('/join#code=');
  await expect(codePanel.getByText(created.code, { exact: true })).toBeVisible();
  await expect(codePanel.getByRole('button', { name: 'Rotate code' })).toBeVisible();

  const firstAttempt = await openEnrollmentLink(browser, created.joinUrl, 201);
  await expect(firstAttempt.page.locator('[data-auth-panel="join"]')).toHaveAttribute('data-auth-state', 'ready');
  await expect(firstAttempt.page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await expect(firstAttempt.page.getByText(created.code, { exact: true })).toHaveCount(0);
  await firstAttempt.context.close();

  await codePanel.getByRole('button', { name: 'Rotate code' }).click();
  const rotationDialog = page.getByRole('alertdialog', { name: 'Rotate the enrollment code?' });
  const rotateResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/admin/enrollment/code/rotate'
  ));
  await rotationDialog.getByRole('button', { name: 'Rotate code' }).click();
  const rotatedHttpResponse = await rotateResponse;
  expect(rotatedHttpResponse.status()).toBe(200);
  const rotated = await rotatedHttpResponse.json() as CodeResponse;
  expect(rotated.code).not.toBe(created.code);
  expect(rotated.version).toBe(created.version + 1);
  expect(rotated.revokedClaims).toBe(1);

  const oldAttempt = await openEnrollmentLink(browser, created.joinUrl, 400);
  await expect(oldAttempt.page.locator('[data-auth-panel="join"]')).toHaveAttribute('data-auth-state', 'invalid');
  await expect(oldAttempt.page.getByRole('alert')).toContainText(/invalid|no longer/i);
  await expect(oldAttempt.page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await oldAttempt.context.close();

  const replacementAttempt = await openEnrollmentLink(browser, rotated.joinUrl, 201);
  await expect(replacementAttempt.page.locator('[data-auth-panel="join"]')).toHaveAttribute('data-auth-state', 'ready');
  await replacementAttempt.context.close();

  await codePanel.getByRole('button', { name: 'Disable code' }).click();
  const disableDialog = page.getByRole('alertdialog', { name: 'Disable the enrollment code?' });
  const disableResponse = page.waitForResponse((response) => (
    response.request().method() === 'DELETE' &&
    new URL(response.url()).pathname === '/api/admin/enrollment/code'
  ));
  await disableDialog.getByRole('button', { name: 'Disable code' }).click();
  const disabledHttpResponse = await disableResponse;
  expect(disabledHttpResponse.status()).toBe(200);
  const disabled = await disabledHttpResponse.json() as DisableResponse;
  expect(disabled).toMatchObject({ disabled: true, changed: true, revokedClaims: 1 });
  const sql = neon(databaseUrl);
  const revokedClaimRows = await sql`
    SELECT claim."status", claim."failureCode"
    FROM "EnrollmentClaim" claim
    JOIN "EnrollmentCode" code ON code."id" = claim."codeId"
    WHERE code."createdByUserId" = ${'e2e_user'}
      AND code."version" = ${rotated.version}
      AND claim."source" = 'shared_code'
  `;
  expect(revokedClaimRows).toEqual([{
    status: 'revoked',
    failureCode: 'code_revoked',
  }]);
  await expect(codePanel.getByRole('button', { name: 'Create code' })).toBeVisible();

  const disabledAttempt = await openEnrollmentLink(browser, rotated.joinUrl, 400);
  await expect(disabledAttempt.page.locator('[data-auth-panel="join"]')).toHaveAttribute('data-auth-state', 'invalid');
  await expect(disabledAttempt.page.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  await disabledAttempt.context.close();
});
