import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const forbiddenRuntimeModules = [
  '@google/genai',
  '@google/generative-ai',
  '@prisma/client',
  '@vercel/',
  'cheerio',
  'prisma',
  'workflow',
] as const;
const nodeBuiltins = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')));

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
  const withoutNodePrefix = moduleName.replace(/^node:/, '');
  if (moduleName.startsWith('node:') || nodeBuiltins.has(withoutNodePrefix)) return true;

  return forbiddenRuntimeModules.some((forbidden) => (
    moduleName === forbidden || moduleName.startsWith(`${forbidden}/`) ||
    (forbidden.endsWith('/') && moduleName.startsWith(forbidden))
  ));
}

function resolveProjectImport(importer: string, moduleName: string): string | null {
  const unresolved = moduleName.startsWith('@/')
    ? join(projectRoot, moduleName.slice(2))
    : moduleName.startsWith('.')
      ? resolve(dirname(importer), moduleName)
      : null;
  if (!unresolved) return null;

  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    join(unresolved, 'index.ts'),
    join(unresolved, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && /\.(?:ts|tsx)$/.test(candidate)) ?? null;
}

function reachableRuntimeSourceFiles(): string[] {
  const pending = listRuntimeSourceFiles(join(projectRoot, 'app'));
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    for (const moduleName of importedModules(readFileSync(file, 'utf8'))) {
      const dependency = resolveProjectImport(file, moduleName);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }

  return Array.from(visited);
}

describe('Cloudflare web Worker runtime policy', () => {
  it('keeps production web source free of Node-only and superseded provider imports', () => {
    const violations = reachableRuntimeSourceFiles()
      .flatMap((file) => importedModules(readFileSync(file, 'utf8'))
        .filter(isForbiddenRuntimeModule)
        .map((moduleName) => `${relative(projectRoot, file)} -> ${moduleName}`))
      .sort();

    expect(violations).toEqual([]);
  });
});
