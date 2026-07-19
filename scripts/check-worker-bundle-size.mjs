import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const DEFAULT_MAX_COMPRESSED_BYTES = 2_800_000;

const INCLUDED_EXTENSIONS = new Set([
  '.bin',
  '.cjs',
  '.js',
  '.json',
  '.mjs',
  '.wasm',
]);

async function listWorkerModules(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(currentPath, entry.name);
    const relativePath = relative(rootPath, absolutePath);
    if (entry.isDirectory()) {
      if (relativePath.split(sep)[0] !== 'assets') {
        files.push(...await listWorkerModules(rootPath, absolutePath));
      }
      continue;
    }
    if (entry.isFile() && INCLUDED_EXTENSIONS.has(extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

export async function measureCompressedWorkerBundle(directory) {
  const rootPath = resolve(directory);
  const rootStat = await stat(rootPath);
  const files = rootStat.isFile() ? [rootPath] : await listWorkerModules(rootPath);
  if (files.length === 0) {
    throw new Error(`No Worker modules found in ${rootPath}.`);
  }

  const contents = await Promise.all(files.map((path) => readFile(path)));
  const sourceBytes = contents.reduce((total, value) => total + value.byteLength, 0);
  const compressedBytes = gzipSync(Buffer.concat(contents), { level: 9 }).byteLength;
  return { sourceBytes, compressedBytes, fileCount: files.length };
}

export async function assertWorkerBundleSize({
  directory,
  maxBytes = DEFAULT_MAX_COMPRESSED_BYTES,
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Worker bundle ceiling must be a positive integer.');
  }
  const result = await measureCompressedWorkerBundle(directory);
  if (result.compressedBytes > maxBytes) {
    throw new Error(
      `Compressed Worker bundle is ${result.compressedBytes} bytes and exceeds the ${maxBytes} bytes ceiling.`,
    );
  }
  return result;
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const directory = process.argv[2] ?? '.open-next';
  const configuredMax = process.env.CLOUDFLARE_MAX_COMPRESSED_BYTES;
  const maxBytes = configuredMax === undefined
    ? DEFAULT_MAX_COMPRESSED_BYTES
    : Number(configuredMax);
  try {
    const result = await assertWorkerBundleSize({ directory, maxBytes });
    console.log(
      `Worker bundle: ${result.compressedBytes} compressed bytes across ${result.fileCount} modules (limit ${maxBytes}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
