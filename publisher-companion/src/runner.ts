import {
  hashPublicationRecipe,
  validatePublicationRecipe,
  type PublicationRecipeV1,
} from '../../server/domain/publication-recipe';

import type {
  PublisherAbortReason,
  PublisherCommandMetadata,
} from './api-client';
import { downloadVerifiedAsset } from './asset-download';
import { materializePublicationBundle } from './materialize';
import { classifySkillPublishResult } from './skill-adapter';

type RunnerApi = {
  claimCommand(): Promise<PublisherCommandMetadata | null>;
  getRecipe(commandId: string): Promise<PublicationRecipeV1>;
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

type RunnerAdapter = {
  prepare(bundlePath: string): Promise<{ draftId: string }>;
  publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason?: string; publishedUrl?: string }>;
};

type Materializer = (input: {
  recipe: unknown;
  expectedRevision: number;
  downloadAsset: (asset: PublicationRecipeV1['assets'][number]) => Promise<Uint8Array>;
  now?: Date;
}) => Promise<{ bundleBytes: Uint8Array; manifest: unknown }>;

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
}) {
  while (input.now().getTime() < Date.parse(input.command.expiresAt)) {
    const status = await input.api.getCommandStatus(input.command.id);
    if (status.revision !== input.command.revision || !equalHash(status.recipeHash, input.command.recipeHash)) {
      throw new Error('Publisher command metadata changed while awaiting approval.');
    }
    if (status.state === 'approved') return status;
    if (['cancelled', 'expired', 'failed', 'outcome_unknown', 'succeeded'].includes(status.state)) {
      return status;
    }
    if (!['awaiting_review', 'awaiting_approval'].includes(status.state)) {
      throw new Error('Publisher command entered an invalid approval state.');
    }
    await input.sleep(2_000);
  }
  return { ...input.command, state: 'expired' as const };
}

export async function runPublisherOnce(input: {
  api: RunnerApi;
  adapter: RunnerAdapter;
  workspace: {
    writeBundle(bytes: Uint8Array, commandId?: string): Promise<string>;
    removeBundle(path: string): Promise<void>;
  };
  materialize?: Materializer;
  downloadAsset?: (input: {
    api: RunnerApi;
    commandId: string;
    asset: PublicationRecipeV1['assets'][number];
  }) => Promise<Uint8Array>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ outcome: string; commandId?: string }> {
  const command = await input.api.claimCommand();
  if (!command) return { outcome: 'idle' };
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const materialize = input.materialize ?? materializePublicationBundle;
  const download = input.downloadAsset ?? downloadVerifiedAsset;
  let bundlePath: string | null = null;
  let began = false;
  let stage: 'assets' | 'composition' | 'publish' = 'assets';

  try {
    const recipe = validatePublicationRecipe(await input.api.getRecipe(command.id), {
      expectedRevision: command.revision,
      now: now(),
    });
    const actualHash = await hashPublicationRecipe(recipe);
    if (!equalHash(actualHash, command.recipeHash)) {
      throw new Error('Publication recipe hash does not match the claimed command.');
    }
    const bundle = await materialize({
      recipe,
      expectedRevision: command.revision,
      now: now(),
      downloadAsset: (asset) => download({ api: input.api, commandId: command.id, asset }),
    });
    bundlePath = await input.workspace.writeBundle(bundle.bundleBytes, command.id);

    stage = 'composition';
    const prepared = await input.adapter.prepare(bundlePath);
    await input.api.reportEditorReady(command.id, command.revision);
    const status = await waitForApproval({ api: input.api, command, now, sleep });
    if (status.state !== 'approved') {
      return { outcome: status.state, commandId: command.id };
    }

    stage = 'publish';
    const skillResult = await input.adapter.publish(prepared.draftId, {
      beforeClick: async () => {
        await input.api.beginPublish(command.id, command.revision);
        began = true;
      },
    });
    const result = classifySkillPublishResult({
      verified: true,
      reason: skillResult.reason ?? 'No canonical URL was returned.',
      ...(skillResult.publishedUrl ? { publishedUrl: skillResult.publishedUrl } : {}),
    });
    await input.api.reportResult(command.id, command.revision, result);
    return { outcome: result.outcome, commandId: command.id };
  } catch {
    if (began || stage === 'publish') {
      await input.api.reportResult(command.id, command.revision, {
        outcome: 'outcome_unknown',
        failureReason: 'OUTCOME_UNVERIFIED',
      }).catch(() => undefined);
      return { outcome: 'outcome_unknown', commandId: command.id };
    }
    const reasonCode: PublisherAbortReason = stage === 'assets'
      ? 'ASSET_INTEGRITY_FAILED'
      : 'EDITOR_COMPOSITION_FAILED';
    await input.api.abortCommand(command.id, command.revision, reasonCode).catch(() => undefined);
    return { outcome: 'cancelled', commandId: command.id };
  } finally {
    if (bundlePath) await input.workspace.removeBundle(bundlePath).catch(() => undefined);
  }
}
