import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Normalize the generated Next reference after the isolated Playwright server exits. */
export default async function globalTeardown(): Promise<void> {
  const declarationPath = resolve('next-env.d.ts');
  const current = await readFile(declarationPath, 'utf8');
  const normalized = current.replace(
    /\.\/\.next-playwright\/(?:dev\/)?types\/routes\.d\.ts/g,
    './.next/types/routes.d.ts',
  );
  if (normalized !== current) await writeFile(declarationPath, normalized, 'utf8');
}
