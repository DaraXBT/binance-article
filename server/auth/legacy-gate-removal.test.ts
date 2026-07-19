import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('legacy shared access gate removal', () => {
  it.each([
    'proxy.ts',
    'middleware.test.ts',
    'app/access/page.tsx',
    'app/api/access/route.ts',
    'app/api/access/route.test.ts',
    'components/access/access-gate-form.tsx',
    'components/access/access-gate-form.test.tsx',
    'lib/app-access.ts',
    'server/auth/app-access.ts',
    'e2e/access-gate.spec.ts',
  ])('removes %s', (file) => {
    expect(existsSync(`${root}${file}`)).toBe(false);
  });

  it.each(['README.md', 'GETTING_STARTED.md', 'SETUP_INSTRUCTIONS.md'])(
    '%s describes account login instead of APP_ACCESS_CODE',
    (file) => {
      const source = readFileSync(`${root}${file}`, 'utf8');
      expect(source).not.toMatch(/APP_ACCESS_CODE|\/api\/access|shared (?:access |app )?gate/i);
    },
  );

  it.each(['e2e/workspace.spec.ts', 'e2e/binance-export.spec.ts'])(
    '%s has no /access workaround',
    (file) => {
      expect(readFileSync(`${root}${file}`, 'utf8')).not.toMatch(/\/access|app-access/i);
    },
  );
});
