import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Cloudflare web Worker deployment configuration', () => {
  it('uses a current OpenNext Worker runtime with the required compatibility flags', () => {
    const config = JSON.parse(readProjectFile('wrangler.jsonc')) as {
      main: string;
      compatibility_date: string;
      compatibility_flags: string[];
      assets: { binding: string; directory: string };
    };

    expect(config.main).toBe('.open-next/worker.js');
    expect(config.compatibility_date >= '2024-09-23').toBe(true);
    expect(config.compatibility_flags).toEqual(expect.arrayContaining([
      'nodejs_compat',
      'global_fetch_strictly_public',
    ]));
    expect(config.assets).toEqual({
      binding: 'ASSETS',
      directory: '.open-next/assets',
    });
  });

  it('binds article assets to private R2 without embedding credentials or a public URL', () => {
    const configSource = readProjectFile('wrangler.jsonc');
    const config = JSON.parse(configSource) as {
      r2_buckets: Array<{ binding: string; bucket_name: string }>;
    };

    expect(config.r2_buckets).toContainEqual({
      binding: 'ARTICLE_ASSETS',
      bucket_name: 'binance-article-assets',
    });
    expect(configSource).not.toMatch(/r2\.dev|access[_-]?key|secret[_-]?access/i);
  });

  it('provides build, local preview, dry-run, and compressed bundle gate scripts', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['cloudflare:build']).toContain('opennextjs-cloudflare build');
    expect(packageJson.scripts['cloudflare:build']).toMatch(
      /^node scripts\/check-cloudflare-build-env\.mjs && /,
    );
    expect(packageJson.scripts['cloudflare:preview']).toContain('wrangler dev');
    expect(packageJson.scripts['cloudflare:dry-run']).toContain('wrangler deploy --dry-run');
    expect(packageJson.scripts['cloudflare:bundle-check']).toContain(
      'scripts/check-worker-bundle-size.mjs',
    );
    expect(packageJson.scripts['cloudflare:dry-run']).not.toMatch(/\bdeploy\b(?! --dry-run)/);
  });

  it('can start the pinned OpenNext CLI with the installed dependency graph', () => {
    const result = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/opennextjs-cloudflare'),
      ['--help'],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Build and deploy OpenNext applications');
  });

  it('keeps generated Worker output out of version control and initializes local dev context', () => {
    expect(readProjectFile('.gitignore')).toMatch(/^\.open-next\/$/m);
    expect(readProjectFile('.gitignore')).toMatch(/^\.wrangler\/$/m);
    expect(readProjectFile('next.config.mjs')).toContain('initOpenNextCloudflareForDev');
    expect(readProjectFile('open-next.config.ts')).toContain('defineCloudflareConfig');
  });
});
