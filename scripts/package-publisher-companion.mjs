import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import JSZip from 'jszip';

const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
const DISTRIBUTION_INPUTS = [
  'publisher-companion/src',
  'publisher-companion/package.json',
  'publisher-companion/bun.lock',
  'publisher-companion/README.md',
  'server/domain/publication-recipe.ts',
  'lib/binance-export.ts',
  '.agents/skills/baoyu-post-to-binance-square/scripts',
  '.agents/skills/baoyu-post-to-x/scripts',
];

function isDistributionFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (
    normalized.includes('/node_modules/')
    || normalized.includes('/.git/')
    || /(^|\/)\.env(?:\.|$)/.test(normalized)
    || /\.test\.[cm]?[jt]sx?$/.test(normalized)
    || /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(normalized)
  ) return false;

  if (normalized.startsWith('publisher-companion/src/')) return normalized.endsWith('.ts');
  if (
    normalized === 'server/domain/publication-recipe.ts'
    || normalized === 'lib/binance-export.ts'
  ) return true;
  if (normalized.startsWith('.agents/skills/')) {
    return normalized.endsWith('.ts')
      || normalized.endsWith('/package.json')
      || normalized.endsWith('/bun.lock');
  }
  return [
    'publisher-companion/package.json',
    'publisher-companion/bun.lock',
    'publisher-companion/README.md',
  ].includes(normalized);
}

async function collectEntry(root, relativePath, output) {
  const absolutePath = path.join(root, relativePath);
  const details = await stat(absolutePath);
  if (details.isDirectory()) {
    const entries = await readdir(absolutePath);
    for (const entry of entries.sort()) {
      await collectEntry(root, path.join(relativePath, entry), output);
    }
    return;
  }
  if (!details.isFile() || !isDistributionFile(relativePath)) return;
  output.push({
    absolutePath,
    archivePath: relativePath.split(path.sep).join('/'),
  });
}

export async function collectPublisherDistributionFiles(root) {
  const files = [];
  for (const relativePath of DISTRIBUTION_INPUTS) {
    await collectEntry(root, relativePath, files);
  }
  return files.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

function installerSource() {
  return `import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projects = [
  'publisher-companion',
  '.agents/skills/baoyu-post-to-binance-square/scripts',
  '.agents/skills/baoyu-post-to-x/scripts',
];

for (const project of projects) {
  const result = spawnSync('bun', ['install', '--frozen-lockfile'], {
    cwd: path.join(root, project),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const doctor = spawnSync('bun', ['run', 'doctor'], {
  cwd: path.join(root, 'publisher-companion'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (doctor.error) throw doctor.error;
if (doctor.status !== 0) process.exit(doctor.status ?? 1);

process.stdout.write('Publisher companion installed. Pair it using the code from the web app.\\n');
`;
}

export async function buildPublisherCompanionArtifact({
  root,
  outputDirectory = path.join(root, '.artifacts'),
}) {
  const packageJson = JSON.parse(await readFile(
    path.join(root, 'publisher-companion/package.json'),
    'utf8',
  ));
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  const directoryName = `xarticle-publisher-companion-${version}`;
  const archiveName = `${directoryName}.zip`;
  const archivePath = path.join(outputDirectory, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const zip = new JSZip();
  const files = await collectPublisherDistributionFiles(root);

  for (const file of files) {
    zip.file(`${directoryName}/${file.archivePath}`, await readFile(file.absolutePath), {
      date: FIXED_ZIP_DATE,
      createFolders: false,
      unixPermissions: 0o644,
    });
  }
  zip.file(`${directoryName}/install.mjs`, installerSource(), {
    date: FIXED_ZIP_DATE,
    createFolders: false,
    unixPermissions: 0o644,
  });

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(archivePath, bytes, { mode: 0o644 });
  await writeFile(checksumPath, `${sha256}  ${archiveName}\n`, { mode: 0o644 });

  return {
    archivePath,
    checksumPath,
    directoryName,
    sha256,
    fileCount: files.length + 1,
  };
}

const invoked = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await buildPublisherCompanionArtifact({ root });
  process.stdout.write(`Publisher companion artifact: ${result.archivePath}\n`);
  process.stdout.write(`SHA-256: ${result.sha256}\n`);
}
