import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

const ConfigSchema = z.object({
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', 'API URL must use HTTPS'),
  deviceId: z.string().trim().min(1).max(200),
}).strict();

export type CompanionConfig = z.infer<typeof ConfigSchema>;

export function getCompanionConfigPath(): string {
  const root = process.env.XDG_CONFIG_HOME
    ?? (process.platform === 'win32' ? process.env.APPDATA : undefined)
    ?? path.join(os.homedir(), '.config');
  return path.join(root, 'xarticle-publisher', 'config.json');
}

export async function saveCompanionConfig(filePath: string, input: CompanionConfig): Promise<void> {
  const config = ConfigSchema.parse(input);
  const directory = path.dirname(path.resolve(filePath));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => undefined);
  const temporaryPath = path.join(directory, `.config-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, 0o600).catch(() => undefined);
}

export async function loadCompanionConfig(filePath = getCompanionConfigPath()): Promise<CompanionConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new Error('Publisher companion is not paired. Run the pair command first.');
  }
  try {
    return ConfigSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('Publisher companion config is invalid; pair the device again.');
  }
}
