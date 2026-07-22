import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { resolveAuthenticatedStorageState } from './fixtures/authenticated';

test.describe('authenticated Playwright storage state', () => {
  test('stays disabled unless authenticated E2E is explicitly requested', () => {
    expect(resolveAuthenticatedStorageState({
      environment: {
        E2E_STORAGE_STATE: JSON.stringify({ cookies: [], origins: [] }),
      },
      cwd: process.cwd(),
    })).toBeUndefined();
  });

  test('accepts storage state JSON supplied by a CI secret', () => {
    expect(resolveAuthenticatedStorageState({
      environment: {
        E2E_AUTHENTICATED: '1',
        E2E_STORAGE_STATE: JSON.stringify({ cookies: [], origins: [] }),
      },
      cwd: process.cwd(),
    })).toEqual({ cookies: [], origins: [] });
  });

  test('resolves an existing storage state file path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xarticle-e2e-auth-'));
    const storageStatePath = join(directory, 'state.json');
    try {
      await writeFile(storageStatePath, JSON.stringify({ cookies: [], origins: [] }));
      expect(resolveAuthenticatedStorageState({
        environment: {
          E2E_AUTHENTICATED: '1',
          E2E_STORAGE_STATE: storageStatePath,
        },
        cwd: process.cwd(),
      })).toBe(storageStatePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('allows global setup to create the configured state path later', () => {
    expect(resolveAuthenticatedStorageState({
      environment: {
        E2E_AUTHENTICATED: '1',
        E2E_SEED_AUTH: '1',
        E2E_STORAGE_STATE: '.playwright/.auth/user.json',
      },
      cwd: '/repo',
    })).toBe('/repo/.playwright/.auth/user.json');
  });

  test('fails clearly when authentication is requested without usable state', () => {
    expect(() => resolveAuthenticatedStorageState({
      environment: { E2E_AUTHENTICATED: '1' },
      cwd: process.cwd(),
    })).toThrow('E2E_AUTHENTICATED=1 requires E2E_STORAGE_STATE');

    expect(() => resolveAuthenticatedStorageState({
      environment: {
        E2E_AUTHENTICATED: '1',
        E2E_STORAGE_STATE: 'not-json-and-not-a-file',
      },
      cwd: process.cwd(),
    })).toThrow('E2E_STORAGE_STATE must be an existing file path or valid Playwright storage-state JSON');
  });

  test('rejects a directory where a storage-state file was expected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xarticle-e2e-auth-directory-'));
    try {
      expect(() => resolveAuthenticatedStorageState({
        environment: {
          E2E_AUTHENTICATED: '1',
          E2E_STORAGE_STATE: directory,
        },
        cwd: process.cwd(),
      })).toThrow(
        'E2E_STORAGE_STATE must be an existing file path or valid Playwright storage-state JSON',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
