import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
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

function importedModules(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const modules: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)
    ) {
      modules.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [argument] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && ts.isStringLiteral(argument)) modules.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return modules;
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

    for (const moduleName of importedModules(file, readFileSync(file, 'utf8'))) {
      const dependency = resolveProjectImport(file, moduleName);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }

  return Array.from(visited);
}

describe('Cloudflare web Worker runtime policy', () => {
  it('keeps production web source free of Node-only and superseded provider imports', () => {
    const violations = reachableRuntimeSourceFiles()
      .flatMap((file) => importedModules(file, readFileSync(file, 'utf8'))
        .filter(isForbiddenRuntimeModule)
        .map((moduleName) => `${relative(projectRoot, file)} -> ${moduleName}`))
      .sort();

    expect(violations).toEqual([]);
  });
});
