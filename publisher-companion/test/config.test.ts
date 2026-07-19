import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadCompanionConfig, saveCompanionConfig } from '../src/config';

describe('publisher companion nonsecret config', () => {
  it('stores only origin and device ID with private permissions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-config-'));
    try {
      const configPath = path.join(root, 'nested', 'config.json');
      await saveCompanionConfig(configPath, {
        baseUrl: 'https://articles.example.com', deviceId: 'device_1',
      });
      await expect(loadCompanionConfig(configPath)).resolves.toEqual({
        baseUrl: 'https://articles.example.com', deviceId: 'device_1',
      });
      const raw = await fs.readFile(configPath, 'utf8');
      expect(raw).not.toMatch(/token|cookie|profile|password/i);
      if (process.platform !== 'win32') {
        expect((await fs.stat(path.dirname(configPath))).mode & 0o777).toBe(0o700);
        expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
