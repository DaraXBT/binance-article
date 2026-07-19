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

describe('API authorization inventory', () => {
  it('classifies every route explicitly and no deleted route remains listed', () => {
    expect(Object.keys(API_ROUTE_POLICIES).sort()).toEqual(
      routeFiles(path.join(root, 'app/api')).sort(),
    );
  });

  it('keeps each policy attached to its concrete authorization boundary', () => {
    const markers = {
      public: ['toNextJsHandler', 'databaseStatus'],
      'invitation-token': ['inspectInvitation'],
      'pairing-token': ['activatePublisherDevice'],
      owner: ['requireOwner: true'],
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
});
