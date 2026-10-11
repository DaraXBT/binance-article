import fs from 'node:fs/promises';
import path from 'node:path';
import type { PendingPublishResult, PublishResultOutbox } from './runner';

function isPendingPublishResult(value: unknown): value is PendingPublishResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  return typeof record.commandId === 'string' && record.commandId.length > 0
    && typeof record.revision === 'number' && Number.isInteger(record.revision)
    && !!result && typeof result === 'object' && typeof result.outcome === 'string';
}

/** Single active command, protected by the companion's process lock. */
export class FilePublishResultOutbox implements PublishResultOutbox {
  constructor(
    private readonly filePath: string,
    private readonly warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<PendingPublishResult | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    if (isPendingPublishResult(value)) return value;
    // An unreadable record can't be replayed; failing on it every run would block all new work.
    await this.#moveAside('corrupt', 'the saved publish result is unreadable');
    return null;
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

  async quarantine(reason: string): Promise<void> {
    await this.#moveAside('rejected', `the server rejected the saved publish result (${reason})`);
  }

  async #moveAside(label: string, why: string): Promise<void> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const target = `${this.filePath}.${label}-${stamp}`;
    await fs.rename(this.filePath, target);
    this.warn(`Publisher: ${why}. Kept it at ${target}; check that command in the web app.`);
  }
}
