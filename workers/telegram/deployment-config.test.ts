import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Telegram Worker deployment configuration', () => {
  it('is a separate Worker with no R2 binding and no live deploy script', () => {
    const source = readFileSync(resolve(process.cwd(), 'wrangler.telegram.jsonc'), 'utf8');
    const config = JSON.parse(source) as {
      main: string;
      compatibility_flags: string[];
      secrets: { required: string[] };
      r2_buckets?: unknown;
    };
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(config.main).toBe('workers/telegram/index.ts');
    expect(config.compatibility_flags).toEqual(expect.arrayContaining([
      'nodejs_compat', 'global_fetch_strictly_public',
    ]));
    expect(config.secrets.required).toEqual(expect.arrayContaining([
      'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET',
      'TELEGRAM_BOT_INFO', 'APP_BASE_URL',
    ]));
    expect(config.r2_buckets).toBeUndefined();
    expect(packageJson.dependencies.grammy).toBe('1.45.1');
    expect(packageJson.scripts['telegram:dev']).toContain('wrangler.telegram.jsonc');
    expect(packageJson.scripts['telegram:dry-run']).toContain('--dry-run');
    expect(packageJson.scripts['telegram:deploy']).toBeUndefined();
  });
});
