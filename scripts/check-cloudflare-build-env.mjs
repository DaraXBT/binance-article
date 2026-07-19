import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isBuildEnvironmentFile(name) {
  return name === '.env' || (name.startsWith('.env.') && name !== '.env.example');
}

export async function findCloudflareBuildEnvironmentFiles(directory = process.cwd()) {
  const entries = await readdir(resolve(directory), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isBuildEnvironmentFile(entry.name))
    .map((entry) => entry.name)
    .sort();
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
