import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { acquireCompanionLock } from '../src/lock';

describe('publisher companion single-instance lock', () => {
  it('allows only one process to control a publisher profile at a time', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publisher-lock-'));
    try {
      const lockPath = path.join(root, 'companion.lock');
      const first = await acquireCompanionLock(lockPath);
      await expect(acquireCompanionLock(lockPath)).rejects.toThrow(/already running/i);
      await first.release();
      const second = await acquireCompanionLock(lockPath);
      await second.release();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
