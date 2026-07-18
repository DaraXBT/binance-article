import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDraftState,
  readDraftState,
  removeDraftState,
  validateDraftForPublish,
} from './draft-state.ts';

const NOW = new Date('2026-07-18T00:00:00.000Z');

test('draft state is private, short lived, and contains no credentials', async (t) => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-draft-state-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));

  const created = await createDraftState({
    cacheRoot,
    now: NOW,
    profileDir: '/tmp/chrome-profile',
    debugPort: 9222,
    targetId: 'target-1',
    editorUrl: 'https://www.binance.com/en/square/creator-center/article/editor',
    titleHash: 'a'.repeat(64),
    bodyHash: 'b'.repeat(64),
    assetHashes: ['c'.repeat(64)],
    bundleDir: '/tmp/extracted-bundle',
  });

  assert.match(created.id, /^[a-f0-9]{32}$/);
  assert.equal(created.expiresAt, '2026-07-18T00:15:00.000Z');
  const raw = await fs.readFile(created.statePath, 'utf8');
  assert.doesNotMatch(raw, /cookie|csrf|token|password/i);
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(created.statePath)).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  const read = await readDraftState(created.id, { cacheRoot, now: new Date(NOW.getTime() + 1_000) });
  assert.equal(read.targetId, 'target-1');
});

test('expired, URL-mismatched, and content-mismatched drafts cannot publish', async (t) => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bs-expired-state-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const created = await createDraftState({
    cacheRoot, now: NOW, profileDir: '/tmp/profile', debugPort: 9222, targetId: 'target',
    editorUrl: 'https://www.binance.com/en/square/creator-center/article/editor',
    titleHash: 'a'.repeat(64), bodyHash: 'b'.repeat(64), assetHashes: [], bundleDir: '/tmp/bundle',
  });

  await assert.rejects(
    readDraftState(created.id, { cacheRoot, now: new Date(NOW.getTime() + 16 * 60_000) }),
    /expired/i,
  );

  const state = await readDraftState(created.id, { cacheRoot, now: new Date(NOW.getTime() + 1_000) });
  assert.throws(() => validateDraftForPublish(state, {
    editorUrl: 'https://example.com/phishing', titleHash: state.titleHash,
    bodyHash: state.bodyHash, assetHashes: state.assetHashes,
  }), /URL|Binance/i);
  assert.throws(() => validateDraftForPublish(state, {
    editorUrl: state.editorUrl, titleHash: 'd'.repeat(64),
    bodyHash: state.bodyHash, assetHashes: state.assetHashes,
  }), /changed|mismatch/i);

  await removeDraftState(created.id, { cacheRoot });
  await assert.rejects(readDraftState(created.id, { cacheRoot, now: NOW }), /not found/i);
});

