import fs from 'node:fs/promises';
import path from 'node:path';
import type { PendingPublishResult, PublishResultOutbox } from './runner';

/** Single active command, protected by the companion's process lock. */
export class FilePublishResultOutbox implements PublishResultOutbox {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PendingPublishResult | null> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8')) as PendingPublishResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(value: PendingPublishResult): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    // Flush before the rename to narrow the window where a power loss leaves an empty outbox.
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
