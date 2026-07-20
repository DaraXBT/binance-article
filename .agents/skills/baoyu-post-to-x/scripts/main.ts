import path from 'node:path';
import process from 'node:process';

import { validateXPostBundleArchive } from './bundle.js';
import { prepareXPostBundle } from './bundle-publisher.js';

function printUsage(): never {
  console.log(`Prepare a reviewed X post bundle in Chrome

Usage:
  bun main.ts --bundle ./article-x-post.zip
  bun main.ts --bundle ./article-x-post.zip --dry-run

Options:
  --bundle <file>       Validated xArticle export ZIP (required)
  --dry-run             Validate the ZIP without opening Chrome
  --profile <dir>       Custom Chrome profile directory
  --chrome-path <path>  Override Chrome executable path
  --help                Show this help

The bundle workflow always opens a preview draft. The final Post click is
manual; --submit is intentionally rejected for reviewed bundles.
`);
  process.exit(0);
}
function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) printUsage();

  let bundlePath: string | undefined;
  let profileDir: string | undefined;
  let chromePath: string | undefined;
  const dryRun = args.includes('--dry-run');

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--bundle') {
      if (bundlePath) throw new Error('Only one --bundle may be provided.');
      bundlePath = requiredValue(args, index, '--bundle');
      index += 1;
    } else if (arg === '--profile') {
      profileDir = requiredValue(args, index, '--profile');
      index += 1;
    } else if (arg === '--chrome-path') {
      chromePath = requiredValue(args, index, '--chrome-path');
      index += 1;
    } else if (arg === '--dry-run') {
      // Parsed above; keeping this branch makes unknown-option handling strict.
    } else if (arg === '--submit') {
      throw new Error('--submit is not supported for reviewed X bundles. Review the draft and click Post manually.');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!bundlePath) throw new Error('--bundle requires a ZIP file path.');
  const absoluteBundlePath = path.isAbsolute(bundlePath)
    ? bundlePath
    : path.resolve(process.cwd(), bundlePath);

  if (dryRun) {
    const validated = await validateXPostBundleArchive(absoluteBundlePath);
    console.log(JSON.stringify({
      valid: true,
      articleId: validated.manifest.articleId,
      characterCount: [...validated.text].length,
      imageCount: validated.manifest.images.length,
    }, null, 2));
    return;
  }

  const result = await prepareXPostBundle({
    bundlePath: absoluteBundlePath,
    profileDir,
    chromePath,
  });
  console.log(`[x-post] Draft composed for article ${result.articleId} (${result.imageCount} image${result.imageCount === 1 ? '' : 's'}).`);
  console.log('[x-post] Chrome remains open for review. Click Post manually when ready.');
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
