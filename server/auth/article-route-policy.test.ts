import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const articleRoutes = [
  'app/api/articles/[id]/route.ts',
  'app/api/articles/[id]/generate/route.ts',
  'app/api/articles/[id]/generate-images/route.ts',
  'app/api/articles/[id]/render/route.ts',
  'app/api/articles/[id]/reorder/route.ts',
  'app/api/articles/[id]/slides/route.ts',
  'app/api/articles/[id]/slides/[slideId]/route.ts',
  'app/api/articles/[id]/assets/[filename]/route.ts',
] as const;

const bodyRoutes = new Set([
  'app/api/articles/[id]/route.ts',
  'app/api/articles/[id]/generate/route.ts',
  'app/api/articles/[id]/generate-images/route.ts',
  'app/api/articles/[id]/reorder/route.ts',
  'app/api/articles/[id]/slides/route.ts',
  'app/api/articles/[id]/slides/[slideId]/route.ts',
]);

describe('article route authorization policy', () => {
  for (const route of articleRoutes) {
    it(`${route} uses active-user article membership instead of a legacy session`, () => {
      const source = readFileSync(`${root}${route}`, 'utf8');
      expect(source).toContain('authorizeArticleRequest');
      expect(source).not.toMatch(/getCurrentWorkspace|WorkspaceSession|deckforge_session/);
      if (bodyRoutes.has(route)) {
        expect(source).toContain('readBoundedJson');
        expect(source).not.toContain('request.json()');
      }
    });
  }
});
