import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isBinanceEditorUrl } from './bundle.ts';

export const DRAFT_TTL_MS = 15 * 60 * 1000;
const DRAFT_ID_PATTERN = /^[a-f0-9]{32}$/;

export interface DraftState {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  profileDir: string;
  debugPort: number;
  targetId: string;
  editorUrl: string;
  titleHash: string;
  bodyHash: string;
  assetHashes: string[];
  bundleDir: string;
  attemptedAt?: string;
  statePath?: string;
}

export interface CreateDraftStateInput {
  cacheRoot?: string;
  now?: Date;
  profileDir: string;
  debugPort: number;
  targetId: string;
  editorUrl: string;
  titleHash: string;
  bodyHash: string;
  assetHashes: string[];
  bundleDir: string;
}

function defaultCacheRoot(): string {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'baoyu-post-to-binance-square');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'baoyu-post-to-binance-square');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'baoyu-post-to-binance-square');
  return path.join(os.homedir(), '.cache', 'baoyu-post-to-binance-square');
}

function draftsRoot(cacheRoot?: string): string {
  return path.join(cacheRoot ?? defaultCacheRoot(), 'drafts');
}

export function isDraftBundlePathSafe(bundleDir: string, cacheRoot?: string): boolean {
  const bundlesRoot = path.resolve(path.join(cacheRoot ?? defaultCacheRoot(), 'bundles'));
  const resolved = path.resolve(bundleDir);
  return resolved.startsWith(`${bundlesRoot}${path.sep}`);
}

function statePathFor(id: string, cacheRoot?: string): string {
  if (!DRAFT_ID_PATTERN.test(id)) throw new Error('Invalid draft ID.');
  return path.join(draftsRoot(cacheRoot), `${id}.json`);
}

function attemptMarkerPathFor(id: string, cacheRoot?: string): string {
  return `${statePathFor(id, cacheRoot)}.attempted`;
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 hash.`);
}

function assertStateShape(value: unknown): DraftState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Draft state is invalid.');
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || typeof state.id !== 'string' || !DRAFT_ID_PATTERN.test(state.id)) {
    throw new Error('Draft state version or ID is invalid.');
  }
  for (const key of ['createdAt', 'expiresAt', 'profileDir', 'targetId', 'editorUrl', 'bundleDir']) {
    if (typeof state[key] !== 'string' || !state[key]) throw new Error(`Draft state ${key} is invalid.`);
  }
  if (!Number.isInteger(state.debugPort) || Number(state.debugPort) < 1 || Number(state.debugPort) > 65535) {
    throw new Error('Draft debug port is invalid.');
  }
  assertHash(String(state.titleHash), 'titleHash');
  assertHash(String(state.bodyHash), 'bodyHash');
  if (!Array.isArray(state.assetHashes) || state.assetHashes.some((hash) => typeof hash !== 'string')) {
    throw new Error('Draft asset hashes are invalid.');
  }
  for (const hash of state.assetHashes as string[]) assertHash(hash, 'assetHash');
  if (!Number.isFinite(Date.parse(String(state.expiresAt)))) throw new Error('Draft expiry is invalid.');
  if (state.attemptedAt !== undefined && (
    typeof state.attemptedAt !== 'string' || !Number.isFinite(Date.parse(state.attemptedAt))
  )) {
    throw new Error('Draft attempted timestamp is invalid.');
  }
  return {
    version: 1,
    id: state.id,
    createdAt: String(state.createdAt),
    expiresAt: String(state.expiresAt),
    profileDir: String(state.profileDir),
    debugPort: Number(state.debugPort),
    targetId: String(state.targetId),
    editorUrl: String(state.editorUrl),
    titleHash: String(state.titleHash),
    bodyHash: String(state.bodyHash),
    assetHashes: [...(state.assetHashes as string[])],
    bundleDir: String(state.bundleDir),
    ...(state.attemptedAt ? { attemptedAt: String(state.attemptedAt) } : {}),
  };
}

export async function createDraftState(input: CreateDraftStateInput): Promise<DraftState & { statePath: string }> {
  const now = input.now ?? new Date();
  if (!isBinanceEditorUrl(input.editorUrl)) throw new Error('Draft editor URL is not a Binance editor URL.');
  if (!Number.isInteger(input.debugPort) || input.debugPort < 1 || input.debugPort > 65535) throw new Error('Invalid debug port.');
  assertHash(input.titleHash, 'titleHash');
  assertHash(input.bodyHash, 'bodyHash');
  input.assetHashes.forEach((hash) => assertHash(hash, 'assetHash'));
  const id = randomBytes(16).toString('hex');
  const root = draftsRoot(input.cacheRoot);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  const statePath = statePathFor(id, input.cacheRoot);
  const state: DraftState = {
    version: 1,
    id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
    profileDir: input.profileDir,
    debugPort: input.debugPort,
    targetId: input.targetId,
    editorUrl: input.editorUrl,
    titleHash: input.titleHash,
    bodyHash: input.bodyHash,
    assetHashes: [...input.assetHashes],
    bundleDir: input.bundleDir,
  };
  const temporaryPath = `${statePath}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(temporaryPath, statePath);
  await fs.chmod(statePath, 0o600).catch(() => undefined);
  return { ...state, statePath };
}

export async function readDraftState(
  id: string,
  options: { cacheRoot?: string; now?: Date } = {},
): Promise<DraftState> {
  const statePath = statePathFor(id, options.cacheRoot);
  let raw: string;
  try {
    raw = await fs.readFile(statePath, 'utf8');
  } catch {
    throw new Error(`Draft ${id} was not found.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Draft state is not valid JSON.'); }
  const state = assertStateShape(parsed);
  const now = options.now ?? new Date();
  if (Date.parse(state.expiresAt) <= now.getTime()) {
    await fs.rm(statePath, { force: true }).catch(() => undefined);
    await fs.rm(attemptMarkerPathFor(id, options.cacheRoot), { force: true }).catch(() => undefined);
    if (isDraftBundlePathSafe(state.bundleDir, options.cacheRoot)) {
      await fs.rm(state.bundleDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw new Error(`Draft ${id} has expired.`);
  }
  return state;
}

export function validateDraftForPublish(
  state: DraftState,
  current: { editorUrl: string; titleHash: string; bodyHash: string; assetHashes: string[] },
): void {
  if (state.attemptedAt) throw new Error('Draft publication was already attempted.');
  if (!isBinanceEditorUrl(current.editorUrl)) throw new Error('Current tab is not a Binance article editor.');
  if (current.editorUrl.split('#')[0] !== state.editorUrl.split('#')[0]) {
    throw new Error('Current editor URL does not match the prepared draft.');
  }
  if (current.titleHash !== state.titleHash || current.bodyHash !== state.bodyHash) {
    throw new Error('Draft content changed after preparation; prepare it again.');
  }
  if (current.assetHashes.length !== state.assetHashes.length ||
      current.assetHashes.some((hash, index) => hash !== state.assetHashes[index])) {
    throw new Error('Draft assets changed after preparation; prepare it again.');
  }
}

export async function markDraftAttempted(
  id: string,
  options: { cacheRoot?: string; now?: Date } = {},
): Promise<DraftState> {
  const state = await readDraftState(id, options);
  if (state.attemptedAt) throw new Error('Draft publication was already attempted.');
  const now = options.now ?? new Date();
  const markerPath = attemptMarkerPathFor(id, options.cacheRoot);
  try {
    await fs.writeFile(markerPath, `${now.toISOString()}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new Error('Draft publication was already attempted.');
  }

  const updated: DraftState = { ...state, attemptedAt: now.toISOString() };
  const statePath = statePathFor(id, options.cacheRoot);
  const temporaryPath = `${statePath}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    await fs.rename(temporaryPath, statePath);
    await fs.chmod(statePath, 0o600).catch(() => undefined);
  } catch {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error('Draft attempted state could not be persisted safely.');
  }
  return updated;
}

export async function removeDraftState(id: string, options: { cacheRoot?: string } = {}): Promise<void> {
  await Promise.all([
    fs.rm(statePathFor(id, options.cacheRoot), { force: true }),
    fs.rm(attemptMarkerPathFor(id, options.cacheRoot), { force: true }),
  ]);
}

export function getDraftCacheRoot(): string {
  return defaultCacheRoot();
}
