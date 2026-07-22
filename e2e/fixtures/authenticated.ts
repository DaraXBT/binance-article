import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  test as base,
  type BrowserContextOptions,
} from '@playwright/test';

type ResolveAuthenticatedStorageStateOptions = {
  environment: Record<string, string | undefined>;
  cwd: string;
};

type ResolvedStorageState = NonNullable<BrowserContextOptions['storageState']>;

function isInlineStorageState(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { cookies?: unknown }).cookies) &&
    Array.isArray((value as { origins?: unknown }).origins),
  );
}

export function resolveAuthenticatedStorageState({
  environment,
  cwd,
}: ResolveAuthenticatedStorageStateOptions): ResolvedStorageState | undefined {
  if (environment.E2E_AUTHENTICATED !== '1') return undefined;

  const configuredState = environment.E2E_STORAGE_STATE?.trim();
  if (!configuredState) {
    throw new Error('E2E_AUTHENTICATED=1 requires E2E_STORAGE_STATE.');
  }

  const statePath = resolve(cwd, configuredState);
  if (environment.E2E_SEED_AUTH === '1') return statePath;
  try {
    if (statSync(statePath).isFile()) return statePath;
  } catch {
    // The value may be inline JSON instead of a path.
  }

  let inlineState: unknown;
  try {
    inlineState = JSON.parse(configuredState);
  } catch {
    throw new Error(
      'E2E_STORAGE_STATE must be an existing file path or valid Playwright storage-state JSON.',
    );
  }
  if (!isInlineStorageState(inlineState)) {
    throw new Error(
      'E2E_STORAGE_STATE must be an existing file path or valid Playwright storage-state JSON.',
    );
  }
  return inlineState as ResolvedStorageState;
}

const authenticatedStorageState = resolveAuthenticatedStorageState({
  environment: process.env,
  cwd: process.cwd(),
});

export const authConfiguredTest = base.extend<{ authConfiguration: void }>({
  authConfiguration: [async ({}, use, testInfo) => {
    testInfo.skip(
      authenticatedStorageState === undefined,
      'Set BASE_URL, E2E_AUTHENTICATED=1, and E2E_STORAGE_STATE for auth-boundary E2E tests.',
    );
    await use();
  }, { auto: true }],
});

export const authenticatedTest = authConfiguredTest.extend({
  storageState: authenticatedStorageState ?? { cookies: [], origins: [] },
});
