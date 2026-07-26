import { expectTypeOf, it } from 'vitest';

import type {
  UseDeckOptions,
  WorkspaceBootstrap,
  WorkspaceCreateResult,
  WorkspaceRecoveryResult,
} from './hooks';
import type { useDeck } from './hooks';
import type { DeckDetailResponse } from './schemas';

type GenerationAccessInvalidReason =
  | 'missing'
  | 'invalid'
  | 'rotated'
  | 'workspace_mismatch'
  | 'session_mismatch'
  | 'revoked'
  | null;

it('publishes the workspace origin and replacement result contract to clients', () => {
  expectTypeOf<WorkspaceBootstrap>().toEqualTypeOf<{
    hasWorkspace: boolean;
    workspaceId: string | null;
    accessKeyPrefix: string | null;
    recoveryKey: string | null;
    workspaceOrigin: 'legacy' | 'account' | null;
    workspaceRole: 'owner' | 'member' | null;
    canReplaceWithLegacy: boolean;
    generateAccessEnabled: boolean;
    hasGenerationAccess: boolean;
    generationAccessInvalidReason: GenerationAccessInvalidReason;
  }>();
  expectTypeOf<WorkspaceCreateResult>().toEqualTypeOf<{
    success: true;
    workspaceId: string;
    created: boolean;
  }>();
  expectTypeOf<WorkspaceRecoveryResult>().toEqualTypeOf<{
    success: true;
    workspaceId: string;
    replacedWorkspace: boolean;
  }>();
});

it('publishes typed deck data and opt-in active-job polling', () => {
  expectTypeOf<UseDeckOptions>().toEqualTypeOf<{
    pollActiveJob?: boolean;
  }>();
  expectTypeOf<ReturnType<typeof useDeck>['data']>()
    .toEqualTypeOf<DeckDetailResponse | undefined>();
});
