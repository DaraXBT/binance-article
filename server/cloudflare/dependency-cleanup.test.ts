import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import lockfile from '../../package-lock.json';
import packageJson from '../../package.json';

const root = resolve(import.meta.dirname, '../..');
const manifest = packageJson as unknown as {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
};
const forbiddenPackages = [
  '@google/genai',
  '@prisma/client',
  '@vercel/analytics',
  '@vercel/blob',
  '@vercel/functions',
  'cheerio',
  'prisma',
  'workflow',
] as const;

function projectFile(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('Cloudflare dependency cleanup', () => {
  it('removes superseded runtime and build packages from the manifest and lockfile', () => {
    const manifestSections: Array<Record<string, unknown> | undefined> = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.overrides,
    ];

    for (const packageName of forbiddenPackages) {
      for (const section of manifestSections) {
        expect(section ?? {}, packageName).not.toHaveProperty(packageName);
      }
      expect(lockfile.packages, packageName).not.toHaveProperty(`node_modules/${packageName}`);
    }
  });

  it('uses framework-native build and typecheck scripts without install side effects', () => {
    expect(packageJson.scripts.build).toBe('next build');
    expect(packageJson.scripts.typecheck).toBe('tsc --noEmit');
    expect(packageJson.scripts).not.toHaveProperty('prisma:generate');
    expect(packageJson.scripts).not.toHaveProperty('postinstall');
    expect(projectFile('.npmrc')).toMatch(/^legacy-peer-deps=true$/m);
  });

  it('removes dead Prisma runtime islands and obsolete database scripts', () => {
    for (const path of [
      'lib/prisma.ts',
      'lib/workspace.ts',
      'lib/workspace.test.ts',
      'server/integrations/prisma.ts',
      'server/modules/workspace/service.ts',
      'server/http/rate-limit.ts',
      'server/http/rate-limit.test.ts',
      'scripts/init-db.ts',
      'scripts/migrate-if-database.mjs',
      'scripts/run-with-default-database-url.mjs',
      'scripts/setup-db.sh',
      'prisma/schema.prisma',
      'prisma/migrations/migration_lock.toml',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }

    expect(projectFile('scripts/create-generate-access-grant.mjs')).not.toMatch(
      /@prisma|process\.argv\s*\[\s*2\s*\]/,
    );
  });

  it('validates Drizzle—not Prisma—in CI', () => {
    const ci = projectFile('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/\bprisma\b/i);
    expect(ci).toContain('npm run db:check');
    expect(ci).toContain('MIGRATION_DATABASE_URL');
  });
});
