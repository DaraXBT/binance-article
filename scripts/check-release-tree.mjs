import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_RELEASE_PATHS = [
  'drizzle/0008_telegram_ai_workflow.sql',
  'drizzle/0009_telegram_illustration_styles.sql',
  'drizzle/0010_binance_master_default.sql',
  'drizzle/0011_grey_vision.sql',
  'drizzle/0012_fresh_lady_deathstrike.sql',
  'drizzle/0013_publication_draft_backfill.sql',
  'drizzle/0014_web_approval_default.sql',
  'drizzle/0015_workspace_ai_credential.sql',
  'drizzle/0016_shared_enrollment.sql',
  'drizzle/0017_publication-kind.sql',
  'drizzle/meta/0008_snapshot.json',
  'drizzle/meta/0009_snapshot.json',
  'drizzle/meta/0010_snapshot.json',
  'drizzle/meta/0011_snapshot.json',
  'drizzle/meta/0012_snapshot.json',
  'drizzle/meta/0013_snapshot.json',
  'drizzle/meta/0014_snapshot.json',
  'drizzle/meta/0015_snapshot.json',
  'drizzle/meta/0016_snapshot.json',
  'drizzle/meta/0017_snapshot.json',
  'drizzle/meta/_journal.json',
  'docs/cutover-0017-runbook.md',
];

export const REMOVED_RUNTIME_PATHS = [
  'app/api/telegram',
  'components/auth/telegram-connection-card.tsx',
  'server/domain/telegram-authorization.ts',
  'server/modules/telegram',
  'workers/telegram',
  'workers/telegram-ai',
  'wrangler.telegram.jsonc',
  'wrangler.telegram-ai.jsonc',
  'tsconfig.telegram.json',
  'tsconfig.telegram-ai.json',
];

/**
 * @param {{status: string, trackedPaths: Set<string>, requiredPaths?: string[], forbiddenPaths?: string[]}} input
 */
export function analyzeReleaseTree({
  status,
  trackedPaths,
  requiredPaths = REQUIRED_RELEASE_PATHS,
  forbiddenPaths = [],
}) {
  const errors = [];
  const pendingPaths = status.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (pendingPaths.length > 0) {
    errors.push(`Working tree has ${pendingPaths.length} pending paths; release from a clean checkout.`);
  }
  for (const requiredPath of requiredPaths) {
    if (!trackedPaths.has(requiredPath)) {
      errors.push(`Release-critical file is not tracked: ${requiredPath}.`);
    }
  }
  for (const forbiddenPath of forbiddenPaths) {
    errors.push(`Removed runtime path is present: ${forbiddenPath}.`);
  }
  return { ready: errors.length === 0, errors };
}

export function checkReleaseTree({ root = process.cwd() } = {}) {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  const trackedOutput = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  const trackedPaths = new Set(trackedOutput.split('\0').filter(Boolean));
  const forbiddenPaths = REMOVED_RUNTIME_PATHS.filter((candidate) => (
    existsSync(path.join(root, candidate))
  ));
  return analyzeReleaseTree({ status, trackedPaths, forbiddenPaths });
}

const invoked = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkReleaseTree({ root });
  if (result.ready) {
    process.stdout.write('Release tree is clean and complete.\n');
  } else {
    result.errors.forEach((error) => process.stderr.write(`${error}\n`));
    process.exitCode = 1;
  }
}
