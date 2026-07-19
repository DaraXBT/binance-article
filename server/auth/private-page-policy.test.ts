import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('private page policy', () => {
  it.each([
    'app/page.tsx',
    'app/workspace/layout.tsx',
    'app/new/layout.tsx',
    'app/articles/layout.tsx',
    'app/settings/layout.tsx',
  ])('%s has a server-side active-user boundary', (file) => {
    expect(readFileSync(`${root}${file}`, 'utf8')).toContain('requireActivePageUser');
  });

  it.each(['app/login/page.tsx', 'app/join/page.tsx'])('%s remains outside private auth', (file) => {
    expect(readFileSync(`${root}${file}`, 'utf8')).not.toContain('requireActivePageUser');
  });
});
