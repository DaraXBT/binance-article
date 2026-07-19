import { randomBytes } from 'node:crypto';
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

async function createBundle(contents: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), 'worker-bundle-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'worker.js'), contents);
  return directory;
}

describe('Cloudflare compressed Worker bundle gate', () => {
  it('accepts a compressed bundle below the configured ceiling', async () => {
    const { assertWorkerBundleSize } = await import('./check-worker-bundle-size.mjs');
    const directory = await createBundle(new TextEncoder().encode('export default {};'.repeat(20)));

    const result = await assertWorkerBundleSize({ directory, maxBytes: 2_800_000 });

    expect(result.fileCount).toBe(1);
    expect(result.compressedBytes).toBeLessThan(2_800_000);
  });

  it('fails closed when compressed Worker modules exceed the ceiling', async () => {
    const { assertWorkerBundleSize } = await import('./check-worker-bundle-size.mjs');
    const directory = await createBundle(randomBytes(4_096));

    await expect(assertWorkerBundleSize({ directory, maxBytes: 100 })).rejects.toThrow(
      /exceeds.*100 bytes/i,
    );
  });
});
