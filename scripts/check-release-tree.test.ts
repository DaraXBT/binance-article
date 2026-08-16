import { describe, expect, it } from 'vitest';

import {
  analyzeReleaseTree,
  REMOVED_RUNTIME_PATHS,
  REQUIRED_RELEASE_PATHS,
} from './check-release-tree.mjs';

const requiredPaths = [
  'drizzle/0012_fresh_lady_deathstrike.sql',
  'drizzle/meta/0012_snapshot.json',
];

describe('release tree guard', () => {
  it('requires every current contract migration, snapshot, and cutover runbook', () => {
    expect(REQUIRED_RELEASE_PATHS).toEqual(expect.arrayContaining([
      'drizzle/0015_workspace_ai_credential.sql',
      'drizzle/meta/0015_snapshot.json',
      'drizzle/0016_shared_enrollment.sql',
      'drizzle/meta/0016_snapshot.json',
      'drizzle/0017_publication-kind.sql',
      'drizzle/meta/0017_snapshot.json',
      'drizzle/0018_soft_unicorn.sql',
      'drizzle/meta/0018_snapshot.json',
      'docs/cutover-0017-runbook.md',
    ]));
  });

  it('keeps every removed Telegram runtime surface out of web-only releases', () => {
    expect(REMOVED_RUNTIME_PATHS).toEqual(expect.arrayContaining([
      'app/api/telegram',
      'components/auth/telegram-connection-card.tsx',
      'server/domain/telegram-authorization.ts',
      'server/modules/telegram',
      'workers/telegram',
      'workers/telegram-ai',
      'wrangler.telegram.jsonc',
      'wrangler.telegram-ai.jsonc',
    ]));
  });

  it('accepts a clean tree containing every required release file', () => {
    expect(analyzeReleaseTree({
      status: '',
      trackedPaths: new Set(requiredPaths),
      requiredPaths,
      forbiddenPaths: [] as string[],
    })).toEqual({ ready: true, errors: [] });
  });

  it('rejects dirty state and release-critical files that are still untracked', () => {
    const result = analyzeReleaseTree({
      status: ' M package.json\n?? drizzle/0012_fresh_lady_deathstrike.sql\n',
      trackedPaths: new Set(),
      requiredPaths,
      forbiddenPaths: [] as string[],
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/working tree has 2 pending paths/i),
      expect.stringMatching(/0012_fresh_lady_deathstrike/),
      expect.stringMatching(/0012_snapshot/),
    ]));
  });

  it('rejects a release that restores a removed Telegram runtime', () => {
    const result = analyzeReleaseTree({
      status: '',
      trackedPaths: new Set(requiredPaths),
      requiredPaths,
      forbiddenPaths: ['workers/telegram/index.ts'],
    });

    expect(result.ready).toBe(false);
    expect(result.errors).toContain('Removed runtime path is present: workers/telegram/index.ts.');
  });
});
