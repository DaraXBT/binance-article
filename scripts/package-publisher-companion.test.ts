import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import {
  buildPublisherCompanionArtifact,
  collectPublisherDistributionFiles,
} from './package-publisher-companion.mjs';

const temporaryDirectories: string[] = [];

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  for (const [entryPath, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const outputPath = path.join(destination, entryPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.async('nodebuffer'));
  }
}

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

  it('contains the complete relative-import graph needed by the installed companion', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'publisher-artifact-graph-'));
    const extractionDirectory = await mkdtemp(path.join(os.tmpdir(), 'publisher-artifact-extract-'));
    temporaryDirectories.push(outputDirectory, extractionDirectory);

    const result = await buildPublisherCompanionArtifact({
      root: process.cwd(),
      outputDirectory,
    });
    await extractArchive(result.archivePath, extractionDirectory);

    const distributionRoot = path.join(extractionDirectory, result.directoryName);
    const buildOutput = path.join(extractionDirectory, 'compiled');
    const build = spawnSync('bun', [
      'build',
      'publisher-companion/src/main.ts',
      '--target=bun',
      '--packages=external',
      `--outdir=${buildOutput}`,
    ], {
      cwd: distributionRoot,
      encoding: 'utf8',
    });

    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
  });
});
