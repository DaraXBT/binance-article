import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const runtimeRoots = ['app', 'lib', 'server', 'workflows'] as const;
const forbiddenRuntimeModules = [
  '@google/genai',
  '@prisma/client',
  '@vercel/analytics',
  '@vercel/blob',
  '@vercel/functions',
  'cheerio',
  'node:',
  'workflow',
] as const;

function listRuntimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listRuntimeSourceFiles(path);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

function importedModules(source: string): string[] {
  const matches = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]/g,
  );
  return Array.from(matches, (match) => match[1]);
}

function isForbiddenRuntimeModule(moduleName: string): boolean {
  return forbiddenRuntimeModules.some((forbidden) => (
    moduleName === forbidden || moduleName.startsWith(`${forbidden}/`) ||
    (forbidden.endsWith(':') && moduleName.startsWith(forbidden))
  ));
}

describe('Cloudflare web Worker runtime policy', () => {
  it('keeps production web source free of Node-only and superseded provider imports', () => {
    const violations = runtimeRoots
      .flatMap((root) => listRuntimeSourceFiles(join(projectRoot, root)))
      .flatMap((file) => importedModules(readFileSync(file, 'utf8'))
        .filter(isForbiddenRuntimeModule)
        .map((moduleName) => `${relative(projectRoot, file)} -> ${moduleName}`))
      .sort();

    expect(violations).toEqual([]);
  });
});
