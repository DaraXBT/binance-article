import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dryRunBundle, prepareBundle } from './bundle-publisher.ts';

const standardBundle = fileURLToPath(new URL('../evals/files/standard.zip', import.meta.url));

test('bundle publisher dry-run stays offline and returns a review summary', async () => {
  const result = await dryRunBundle(standardBundle);
  assert.equal(result.valid, true);
  assert.equal(result.title, 'Standard article');
  assert.equal(result.imageCount, 1);
  assert.equal(result.coverPath, 'images/cover.jpg');
});

test('prepareBundle routes dry-run requests without creating draft state', async () => {
  const result = await prepareBundle({ bundlePath: standardBundle, dryRun: true });
  assert.equal('id' in result, false);
  if (!('valid' in result)) assert.fail('Expected dry-run preparation to return a DryRunResult.');
  assert.equal(result.valid, true);
});
