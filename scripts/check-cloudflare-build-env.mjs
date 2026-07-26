import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isBuildEnvironmentFile(name) {
  return name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
}

// The OpenNext bundle also packages these trees (see
// scripts/package-publisher-companion.mjs), so env files inside them are just
// as dangerous as one at the repo root.
const SCANNED_SUBDIRECTORIES = ['publisher-companion', '.baoyu-skills'];

async function listEnvironmentFiles(directory, prefix = '') {
  let entries;
  try {
    entries = await readdir(resolve(directory), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && isBuildEnvironmentFile(entry.name))
    .map((entry) => `${prefix}${entry.name}`);
}

export async function findCloudflareBuildEnvironmentFiles(directory = process.cwd()) {
  const root = resolve(directory);
  const found = await listEnvironmentFiles(root);
  for (const subdirectory of SCANNED_SUBDIRECTORIES) {
    found.push(...await listEnvironmentFiles(
      resolve(root, subdirectory),
      `${subdirectory}/`,
    ));
  }
  return found.sort();
}

export async function assertCloudflareBuildEnvironment(directory = process.cwd()) {
  const unexpectedFiles = await findCloudflareBuildEnvironmentFiles(directory);
  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Cloudflare build refused because local environment files are present: ${unexpectedFiles.join(', ')}. Build from a clean checkout and configure secrets as Worker bindings.`,
    );
  }
  return unexpectedFiles;
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    await assertCloudflareBuildEnvironment(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
