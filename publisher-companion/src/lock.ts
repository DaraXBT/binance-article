import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

async function processIsAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function createLock(lockPath: string): Promise<FileHandle> {
  const handle = await fs.open(lockPath, 'wx', 0o600);
  await handle.writeFile(`${process.pid}\n`, 'utf8');
  return handle;
}

export async function acquireCompanionLock(lockPath: string) {
  const resolved = path.resolve(lockPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  let handle: FileHandle;
  try {
    handle = await createLock(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingPid = Number((await fs.readFile(resolved, 'utf8').catch(() => '')).trim());
    if (await processIsAlive(existingPid)) throw new Error('Publisher companion is already running.');
    await fs.rm(resolved, { force: true });
    handle = await createLock(resolved);
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => undefined);
      await fs.rm(resolved, { force: true });
    },
  };
}
