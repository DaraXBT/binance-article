import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('private page policy', () => {
  it.each([
    'app/workspace/page.tsx',
    'app/new/layout.tsx',
    'app/articles/[id]/layout.tsx',
    'app/settings/layout.tsx',
  ])('%s has a server-side active-user boundary', (file) => {
    expect(readFileSync(`${root}${file}`, 'utf8')).toContain('requireActivePageUser');
  });

  it.each(['app/login/page.tsx', 'app/join/page.tsx'])('%s remains outside private auth', (file) => {
    expect(readFileSync(`${root}${file}`, 'utf8')).not.toContain('requireActivePageUser');
  });

  it('keeps the root home public and free of private workspace bootstrapping', () => {
    const source = readFileSync(`${root}app/page.tsx`, 'utf8');
    expect(source).not.toContain('requireActivePageUser');
    expect(source).toContain('PublicHome');
    expect(source).not.toContain('DashboardHome');
  });
});
