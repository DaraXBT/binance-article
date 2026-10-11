import {
  hashPublicationRecipe,
  publicationRecipeKind,
  publicationRecipeTarget,
  validatePublicationRecipe,
  type PublicationRecipe,
} from '../../server/domain/publication-recipe';

import type {
  PublisherAbortReason,
  PublisherKind,
  PublisherCommandMetadata,
  PublisherTarget,
} from './api-client';
import { downloadVerifiedAsset } from './asset-download';
import { materializePublicationBundle } from './materialize';
import {
  classifySkillPublishResult,
  type PublisherAdapter,
} from './skill-adapter';
import { materializeXPublicationBundle } from './x-materialize';

type RunnerApi = {
  claimCommand(): Promise<PublisherCommandMetadata | null>;
  getRecipe(commandId: string): Promise<PublicationRecipe>;
  downloadAsset(commandId: string, assetId: string): Promise<Response>;
  reportEditorReady(commandId: string, revision: number): Promise<void>;
  getCommandStatus(commandId: string): Promise<PublisherCommandMetadata>;
  beginPublish(commandId: string, revision: number): Promise<void>;
  reportResult(
    commandId: string,
    revision: number,
    result:
      | { outcome: 'succeeded'; publishedUrl: string }
      | { outcome: 'failed' | 'outcome_unknown'; failureReason: string },
  ): Promise<void>;
  abortCommand(commandId: string, revision: number, reasonCode: PublisherAbortReason): Promise<void>;
};

export type PendingPublishResult = {
  commandId: string;
  revision: number;
  result: Parameters<RunnerApi['reportResult']>[2];
};

export interface PublishResultOutbox {
  load(): Promise<PendingPublishResult | null>;
  save(value: PendingPublishResult): Promise<void>;
  clear(): Promise<void>;
}

type Materializer = (input: {
  recipe: unknown;
  expectedRevision: number;
  downloadAsset: (asset: PublicationRecipe['assets'][number]) => Promise<Uint8Array>;
  now?: Date;
}) => Promise<{ bundleBytes: Uint8Array; manifest: unknown }>;

const LEGACY_PUBLICATION_TARGET: PublisherTarget = 'binance-square';

type PublisherRoute = PublisherTarget | `${PublisherTarget}:${PublisherKind}`;

function legacyKind(target: PublisherTarget): PublisherKind {
  return target === 'x' ? 'post' : 'article';
}

function abortReasonFor(error: unknown, fallback: PublisherAbortReason): PublisherAbortReason {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'X_LOGIN_REQUIRED' || code === 'X_ARTICLES_UNAVAILABLE') return code;
  }
  return fallback;
}

function equalHash(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function waitForApproval(input: {
  api: RunnerApi;
  command: PublisherCommandMetadata;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  kind: PublisherKind;
  requireExplicitMetadata: boolean;
  signal?: AbortSignal;
}) {
  while (input.now().getTime() < Date.parse(input.command.expiresAt)) {
    if (input.signal?.aborted) throw new Error('Publisher shutdown requested.');
    const status = await input.api.getCommandStatus(input.command.id);
    if (
      (input.requireExplicitMetadata && (!status.target || !status.kind))
      ||
      status.revision !== input.command.revision
      || !equalHash(status.recipeHash, input.command.recipeHash)
      || (status.target ?? LEGACY_PUBLICATION_TARGET)
        !== (input.command.target ?? LEGACY_PUBLICATION_TARGET)
      || (status.kind ?? legacyKind(status.target ?? LEGACY_PUBLICATION_TARGET)) !== input.kind
    ) {
      throw new Error('Publisher command metadata changed while awaiting approval.');
    }
    if (status.state === 'approved') return status;
    if (['cancelled', 'expired', 'failed', 'outcome_unknown', 'succeeded'].includes(status.state)) {
      return status;
    }
    if (!['awaiting_review', 'awaiting_approval'].includes(status.state)) {
      throw new Error('Publisher command entered an invalid approval state.');
    }
    if (!input.signal) {
      await input.sleep(2_000);
    } else {
      const signal = input.signal;
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error('Publisher shutdown requested.'));
        if (signal.aborted) {
          abort();
          return;
        }
        // The signal lives for the whole process; drop the listener after each poll.
        signal.addEventListener('abort', abort, { once: true });
        input.sleep(2_000).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    }
  }
  return { ...input.command, state: 'expired' as const };
}

export async function runPublisherOnce(input: {
  api: RunnerApi;
  adapter?: PublisherAdapter;
  adapters?: Partial<Record<PublisherRoute, PublisherAdapter>>;
  workspace: {
    writeBundle(bytes: Uint8Array, commandId?: string): Promise<string>;
    removeBundle(path: string): Promise<void>;
  };
  materialize?: Materializer;
  materializers?: Partial<Record<PublisherRoute, Materializer>>;
  downloadAsset?: (input: {
    api: RunnerApi;
    commandId: string;
    asset: PublicationRecipe['assets'][number];
  }) => Promise<Uint8Array>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  outbox?: PublishResultOutbox;
}): Promise<{ outcome: string; commandId?: string }> {
  const pending = await input.outbox?.load();
  if (pending) {
    const status = await input.api.getCommandStatus(pending.commandId);
    let outcome: string = status.state;
    if (status.state === 'publishing') {
      await input.api.reportResult(pending.commandId, pending.revision, pending.result);
      outcome = pending.result.outcome;
    } else if (!['succeeded', 'failed', 'outcome_unknown', 'cancelled', 'expired'].includes(status.state)) {
      // A crash before begin did not authorize a click. Cancel that abandoned composer.
      await input.api.abortCommand(pending.commandId, pending.revision, 'DEVICE_SHUTDOWN');
      outcome = 'cancelled';
    }
    await input.outbox!.clear();
    return { outcome, commandId: pending.commandId };
  }
  if (input.signal?.aborted) return { outcome: 'idle' };
  const command = await input.api.claimCommand();
  if (!command) return { outcome: 'idle' };
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const target = command.target ?? LEGACY_PUBLICATION_TARGET;
  const download = input.downloadAsset ?? downloadVerifiedAsset;
  let bundlePath: string | null = null;
  let preparedDraftId: string | null = null;
  let adapter: PublisherAdapter | undefined;
  let began = false;
  let stage: 'assets' | 'composition' | 'publish' = 'assets';

  try {
    const recipe = validatePublicationRecipe(await input.api.getRecipe(command.id), {
      expectedRevision: command.revision,
      now: now(),
    });
    if (recipe.version === 3 && (!command.target || !command.kind)) {
      throw new Error('V3 publisher commands require explicit target and kind metadata.');
    }
    if (publicationRecipeTarget(recipe) !== target) {
      throw new Error('Publication recipe target does not match the claimed command.');
    }
    const kind = publicationRecipeKind(recipe);
    if (command.kind && command.kind !== kind) {
      throw new Error('Publication recipe kind does not match the claimed command.');
    }
    const actualHash = await hashPublicationRecipe(recipe);
    if (!equalHash(actualHash, command.recipeHash)) {
      throw new Error('Publication recipe hash does not match the claimed command.');
    }
    const route: `${PublisherTarget}:${PublisherKind}` = `${target}:${kind}`;
    adapter = recipe.version === 3
      ? input.adapters?.[route]
      : input.adapters?.[target]
        ?? (target === LEGACY_PUBLICATION_TARGET ? input.adapter : undefined);
    const materialize = input.materialize
      ?? (recipe.version === 3
        ? input.materializers?.[route]
        : input.materializers?.[target])
      ?? (target === 'x' ? materializeXPublicationBundle : materializePublicationBundle);
    const bundle = await materialize({
      recipe,
      expectedRevision: command.revision,
      now: now(),
      downloadAsset: (asset) => download({ api: input.api, commandId: command.id, asset }),
    });
    bundlePath = await input.workspace.writeBundle(bundle.bundleBytes, command.id);

    stage = 'composition';
    if (!adapter) throw new Error(`No publisher adapter is configured for ${target}.`);
    const prepared = await adapter.prepare(bundlePath);
    preparedDraftId = prepared.draftId;
    await input.api.reportEditorReady(command.id, command.revision);
    const status = await waitForApproval({
      api: input.api,
      command,
      now,
      sleep,
      kind,
      requireExplicitMetadata: recipe.version === 3,
      signal: input.signal,
    });
    if (status.state !== 'approved') {
      return { outcome: status.state, commandId: command.id };
    }

    stage = 'publish';
    if (input.signal?.aborted) throw new Error('Publisher shutdown requested.');
    const skillResult = await adapter.publish(prepared.draftId, {
      beforeClick: async () => {
        if (input.signal?.aborted) throw new Error('Publisher shutdown requested.');
        await input.outbox?.save({
          commandId: command.id, revision: command.revision,
          result: { outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' },
        });
        if (input.signal?.aborted) throw new Error('Publisher shutdown requested.');
        await input.api.beginPublish(command.id, command.revision);
        began = true;
        if (input.signal?.aborted) throw new Error('Publisher shutdown requested.');
      },
    });
    const result = classifySkillPublishResult({
      verified: true,
      reason: skillResult.reason ?? 'No canonical URL was returned.',
      ...(skillResult.publishedUrl ? { publishedUrl: skillResult.publishedUrl } : {}),
    }, target, recipe.version === 3 ? kind : undefined);
    await input.outbox?.save({ commandId: command.id, revision: command.revision, result });
    let reported = false;
    for (let attempt = 0; attempt < 3 && !reported; attempt += 1) {
      try {
        await input.api.reportResult(command.id, command.revision, result);
        reported = true;
      } catch {
        if (attempt < 2) await sleep(1_000);
      }
    }
    if (!reported) {
      return { outcome: 'result_pending', commandId: command.id };
    }
    await input.outbox?.clear();
    return { outcome: result.outcome, commandId: command.id };
  } catch (error) {
    if (began) {
      await input.api.reportResult(command.id, command.revision, {
        outcome: 'outcome_unknown',
        failureReason: 'OUTCOME_UNVERIFIED',
      }).catch(() => undefined);
      return { outcome: 'outcome_unknown', commandId: command.id };
    }
    const fallbackReason: PublisherAbortReason = stage === 'assets'
      ? 'ASSET_INTEGRITY_FAILED'
      : 'EDITOR_COMPOSITION_FAILED';
    const reasonCode = input.signal?.aborted ? 'DEVICE_SHUTDOWN' : abortReasonFor(error, fallbackReason);
    try {
      await input.api.abortCommand(command.id, command.revision, reasonCode);
      await input.outbox?.clear();
      return { outcome: 'cancelled', commandId: command.id };
    } catch {
      const status = await input.api.getCommandStatus(command.id).catch(() => null);
      if (status?.state === 'publishing') {
        await input.api.reportResult(command.id, command.revision, {
          outcome: 'outcome_unknown',
          failureReason: 'OUTCOME_UNVERIFIED',
        }).catch(() => undefined);
        return { outcome: 'outcome_unknown', commandId: command.id };
      }
      if (status && ['cancelled', 'expired', 'failed', 'outcome_unknown', 'succeeded'].includes(status.state)) {
        return { outcome: status.state, commandId: command.id };
      }
      return { outcome: 'local_failure', commandId: command.id };
    }
  } finally {
    if (preparedDraftId && adapter?.discard) {
      await adapter.discard(preparedDraftId).catch(() => undefined);
    }
    if (bundlePath) await input.workspace.removeBundle(bundlePath).catch(() => undefined);
  }
}
