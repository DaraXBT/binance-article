import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class LocalBundleWorkspace {
  readonly #roots = new Set<string>();

  async writeBundle(bytes: Uint8Array): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xarticle-publisher-'));
    this.#roots.add(root);
    await fs.chmod(root, 0o700).catch(() => undefined);
    const bundlePath = path.join(root, 'publication.zip');
    await fs.writeFile(bundlePath, bytes, { mode: 0o600, flag: 'wx' });
    await fs.chmod(bundlePath, 0o600).catch(() => undefined);
    return bundlePath;
  }

  async removeBundle(bundlePath: string): Promise<void> {
    const root = path.dirname(path.resolve(bundlePath));
    if (!this.#roots.delete(root)) throw new Error('Companion bundle path is outside this process workspace.');
    await fs.rm(root, { recursive: true, force: true });
  }
}
