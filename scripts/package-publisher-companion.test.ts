import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import {
  buildPublisherCompanionArtifact,
  collectPublisherDistributionFiles,
} from './package-publisher-companion.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('publisher companion release artifact', () => {
  it('collects the companion and both adapters without development or secret files', async () => {
    const root = process.cwd();
    const files = await collectPublisherDistributionFiles(root) as Array<{
      archivePath: string;
    }>;
    const paths = files.map((file) => file.archivePath);

    expect(paths).toContain('publisher-companion/src/main.ts');
    expect(paths).toContain('.agents/skills/baoyu-post-to-binance-square/scripts/bundle-publisher.ts');
    expect(paths).toContain('.agents/skills/baoyu-post-to-x/scripts/x-utils.ts');
    expect(paths.some((file) => /node_modules|\.env|\.test\.[cm]?[jt]sx?$/.test(file))).toBe(false);
  });

  it('builds a bounded ZIP with an installer and SHA-256 sidecar', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'publisher-artifact-test-'));
    temporaryDirectories.push(outputDirectory);

    const result = await buildPublisherCompanionArtifact({
      root: process.cwd(),
      outputDirectory,
    });
    const archive = await JSZip.loadAsync(await readFile(result.archivePath));

    expect(Object.keys(archive.files)).toContain(`${result.directoryName}/install.mjs`);
    expect(Object.keys(archive.files)).toContain(
      `${result.directoryName}/publisher-companion/src/doctor.ts`,
    );
    expect((await readFile(result.checksumPath, 'utf8')).trim())
      .toBe(`${result.sha256}  ${path.basename(result.archivePath)}`);
  });

  it('builds byte-identical archives regardless of the packaging time', async () => {
    const firstDirectory = await mkdtemp(path.join(os.tmpdir(), 'publisher-artifact-first-'));
    const secondDirectory = await mkdtemp(path.join(os.tmpdir(), 'publisher-artifact-second-'));
    temporaryDirectories.push(firstDirectory, secondDirectory);

    const first = await buildPublisherCompanionArtifact({
      root: process.cwd(),
      outputDirectory: firstDirectory,
    });
    const second = await buildPublisherCompanionArtifact({
      root: process.cwd(),
      outputDirectory: secondDirectory,
    });

    expect(second.sha256).toBe(first.sha256);
    const archive = await JSZip.loadAsync(await readFile(first.archivePath));
    expect(Object.values(archive.files).every((entry) => (
      entry.date.toISOString() === '1980-01-01T00:00:00.000Z'
    ))).toBe(true);
  });
});
