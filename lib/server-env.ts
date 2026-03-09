import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL_ENV_FILES = ['.env.local', '.env.vercel.local'] as const;

let localEnvCache: Record<string, string> | null = null;

function parseEnvFile(contents: string) {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf('=');
    const key = normalizedLine.slice(0, separatorIndex).trim();
    let value = normalizedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function getLocalEnvCache() {
  if (localEnvCache) {
    return localEnvCache;
  }

  const merged: Record<string, string> = {};

  for (const filename of LOCAL_ENV_FILES) {
    const filePath = path.join(process.cwd(), filename);
    if (!existsSync(filePath)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(readFileSync(filePath, 'utf8')));
  }

  localEnvCache = merged;
  return localEnvCache;
}

export function getServerEnv(key: string) {
  const directValue = process.env[key]?.trim();
  if (directValue) {
    return directValue;
  }

  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return undefined;
  }

  return getLocalEnvCache()[key];
}

export function resetLocalEnvCacheForTests() {
  localEnvCache = null;
}
