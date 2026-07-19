import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

async function createDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'cloudflare-env-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Cloudflare build environment preflight', () => {
  it('allows documentation templates but never reads their contents', async () => {
    const { assertCloudflareBuildEnvironment } = await import('./check-cloudflare-build-env.mjs');
    const directory = await createDirectory();
    await writeFile(join(directory, '.env.example'), 'SECRET=documentation-only');

    await expect(assertCloudflareBuildEnvironment(directory)).resolves.toEqual([]);
  });

  it('rejects local and mode-specific env files by name before OpenNext starts', async () => {
    const { assertCloudflareBuildEnvironment } = await import('./check-cloudflare-build-env.mjs');
    const directory = await createDirectory();
    await Promise.all([
      writeFile(join(directory, '.env.example'), 'SAFE=template'),
      writeFile(join(directory, '.env.local'), 'DO_NOT_PRINT=this-value'),
      writeFile(join(directory, '.env.production'), 'ALSO_PRIVATE=this-value'),
    ]);

    await expect(assertCloudflareBuildEnvironment(directory)).rejects.toThrow(
      /\.env\.local, \.env\.production/,
    );
  });
});
