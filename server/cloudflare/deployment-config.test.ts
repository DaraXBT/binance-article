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
      secrets: { required: string[] };
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
    expect(config.secrets.required).toEqual([
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'TELEGRAM_CLIENT_ID',
      'TELEGRAM_CLIENT_SECRET',
    ]);
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

  it('binds the web Worker to a separately deployed idempotent article Workflow', () => {
    const config = JSON.parse(readProjectFile('wrangler.jsonc')) as {
      workflows: Array<Record<string, unknown>>;
    };
    expect(config.workflows).toEqual([{
      binding: 'ARTICLE_JOBS',
      name: 'binance-article-jobs',
      class_name: 'ArticleJobsWorkflow',
      script_name: 'binance-article-workflows',
    }]);
  });

  it('configures a non-public Workflow Worker with only required bindings and secrets', () => {
    const source = readProjectFile('wrangler.workflow.jsonc');
    const config = JSON.parse(source) as {
      name: string;
      main: string;
      compatibility_date: string;
      compatibility_flags: string[];
      workflows: Array<Record<string, unknown>>;
      r2_buckets: Array<Record<string, unknown>>;
      secrets: { required: string[] };
      routes?: unknown;
    };
    expect(config).toMatchObject({
      name: 'binance-article-workflows',
      main: 'workers/article-workflow/index.ts',
    });
    expect(config.compatibility_date >= '2025-04-01').toBe(true);
    expect(config.compatibility_flags).toContain('nodejs_compat');
    expect(config.workflows).toEqual([{
      binding: 'ARTICLE_JOBS',
      name: 'binance-article-jobs',
      class_name: 'ArticleJobsWorkflow',
    }]);
    expect(config.r2_buckets).toContainEqual({
      binding: 'ARTICLE_ASSETS', bucket_name: 'binance-article-assets',
    });
    expect(config.secrets.required).toEqual(['DATABASE_URL', 'GEMINI_API_KEY']);
    expect(config.routes).toBeUndefined();
    expect(source).not.toMatch(/r2\.dev|access[_-]?key|secret[_-]?access/i);

    const workerSource = readProjectFile('workers/article-workflow/index.ts');
    expect(workerSource).toContain("from 'cloudflare:workers'");
    expect(workerSource).toMatch(/class ArticleJobsWorkflow extends WorkflowEntrypoint/);
    expect(workerSource).toMatch(/step\.do\([\s\S]*retries[\s\S]*timeout/);
    expect(workerSource).not.toMatch(/\bfetch\s*\(/);
  });

  it('provides build, local preview, dry-run, and compressed bundle gate scripts', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>;
      engines: Record<string, string>;
      devDependencies: Record<string, string>;
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
    expect(packageJson.scripts['workflow:dev']).toContain(
      'wrangler dev --config wrangler.workflow.jsonc',
    );
    expect(packageJson.scripts['workflow:dry-run']).toContain(
      'wrangler deploy --config wrangler.workflow.jsonc --dry-run',
    );
    expect(packageJson.scripts['cloudflare:bundle-check']).toContain('.wrangler/dry-run');
    expect(packageJson.scripts['cloudflare:build']).not.toContain('cloudflare:bundle-check');
    expect(packageJson.scripts['cloudflare:dry-run']).not.toMatch(/\bdeploy\b(?! --dry-run)/);
    expect(packageJson.engines.node).toBe('>=22');
    expect(packageJson.devDependencies['@opennextjs/cloudflare']).toBe('1.20.1');
    expect(packageJson.devDependencies.wrangler).toBe('4.112.0');
  });

  it('can start the pinned OpenNext CLI with the installed dependency graph', () => {
    const result = spawnSync(
      resolve(process.cwd(), 'node_modules/.bin/opennextjs-cloudflare'),
      ['--help'],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Build an OpenNext Cloudflare worker');
  });

  it('keeps generated Worker output out of version control and initializes local dev context', () => {
    expect(readProjectFile('.gitignore')).toMatch(/^\.open-next\/$/m);
    expect(readProjectFile('.gitignore')).toMatch(/^\.wrangler\/$/m);
    expect(readProjectFile('next.config.mjs')).toContain('initOpenNextCloudflareForDev');
    expect(readProjectFile('open-next.config.ts')).toContain('defineCloudflareConfig');
  });

  it('gives immutable Next static assets a one-year edge cache policy', () => {
    expect(readProjectFile('public/_headers')).toBe([
      '/_next/static/*',
      '  Cache-Control: public,max-age=31536000,immutable',
      '',
    ].join('\n'));
  });
});
