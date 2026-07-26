import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The Playwright dev server builds into .next-playwright and Next rewrites
 * the tracked next-env.d.ts to point at it. Restore the canonical reference
 * so a crashed run never leaves the working tree dirty for
 * `npm run release:tree-check`. Runs in both global setup (repairing a
 * previous crash) and teardown.
 */
export async function restoreNextEnvDeclaration(): Promise<void> {
  const declarationPath = resolve('next-env.d.ts');
  const current = await readFile(declarationPath, 'utf8');
  const normalized = current.replace(
    /\.\/\.next-playwright\/(?:dev\/)?types\/routes\.d\.ts/g,
    './.next/types/routes.d.ts',
  );
  if (normalized !== current) await writeFile(declarationPath, normalized, 'utf8');
}
