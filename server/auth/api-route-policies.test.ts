import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { API_ROUTE_POLICIES } from './api-route-policies';

const root = fileURLToPath(new URL('../../', import.meta.url));

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.name === 'route.ts' ? [path.relative(root, absolute)] : [];
  });
}

function conflictingDynamicSegments(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  const dynamicSegments = entries
    .map((entry) => entry.name.match(/^\[([^.[\]]+)\]$/)?.[1])
    .filter((name): name is string => Boolean(name));
  const conflicts = new Set(dynamicSegments).size > 1
    ? [path.relative(root, directory)]
    : [];

  return [
    ...conflicts,
    ...entries.flatMap((entry) => (
      conflictingDynamicSegments(path.join(directory, entry.name))
    )),
  ];
}

describe('API authorization inventory', () => {
  it('keeps publisher device lifecycle routes behind an active user session', () => {
    expect(API_ROUTE_POLICIES).toMatchObject({
      'app/api/publisher/devices/route.ts': 'active-user',
      'app/api/publisher/devices/[id]/route.ts': 'active-user',
    });
  });

  it('uses one slug name for sibling dynamic route segments', () => {
    expect(conflictingDynamicSegments(path.join(root, 'app/api'))).toEqual([]);
  });

  it('classifies every route explicitly and no deleted route remains listed', () => {
    expect(Object.keys(API_ROUTE_POLICIES).sort()).toEqual(
      routeFiles(path.join(root, 'app/api')).sort(),
    );
  });

  it('keeps each policy attached to its concrete authorization boundary', () => {
    const markers = {
      public: ['toNextJsHandler', 'databaseStatus'],
      'invitation-token': ['claimLegacyInvitation'],
      'enrollment-code': ['claimEnrollmentCode'],
      'enrollment-session': ['requireEnrollmentUser'],
      'pairing-token': ['activatePublisherDevice'],
      owner: ['requireOwner: true'],
      'workspace-owner': ['requireActorWorkspaceOwner'],
      'active-user': ['requireActiveUser'],
      'article-member': ['authorizeArticleRequest', 'resolveArticleWorkspace'],
      'device-bearer': ['authenticatePublisherDevice'],
    } as const;

    for (const [file, policy] of Object.entries(API_ROUTE_POLICIES)) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(
        markers[policy].some((marker) => source.includes(marker)),
        `${file} does not implement its ${policy} boundary`,
      ).toBe(true);
    }
  });

  it('bounds every publication mutation body before validation', () => {
    for (const file of [
      'app/api/articles/[id]/publications/binance/prepare/route.ts',
      'app/api/articles/[id]/publications/binance/route.ts',
      'app/api/articles/[id]/publications/x/prepare/route.ts',
      'app/api/articles/[id]/publications/x/route.ts',
      'app/api/publisher/commands/[id]/abort/route.ts',
      'app/api/publisher/commands/[id]/approve/route.ts',
      'app/api/publisher/commands/[id]/begin/route.ts',
      'app/api/publisher/commands/[id]/editor-ready/route.ts',
      'app/api/publisher/commands/[id]/result/route.ts',
      'app/api/publisher/commands/[id]/route.ts',
    ]) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).toContain('readBoundedJson');
    }
  });

  it('does not parse unbounded JSON bodies in API routes', () => {
    for (const file of routeFiles(path.join(root, 'app/api'))) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).not.toContain('request.json()');
    }
  });
});
