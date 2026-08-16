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

it('publishes only account-facing bootstrap and mutation results to clients', () => {
  expectTypeOf<WorkspaceBootstrap>().toEqualTypeOf<{
    hasWorkspace: boolean;
    workspaceRole: 'owner' | 'member' | null;
    canReplaceWithLegacy: boolean;
    generateAccessEnabled: boolean;
    hasGenerationAccess: boolean;
    generationAccessInvalidReason: GenerationAccessInvalidReason;
  }>();
  expectTypeOf<WorkspaceCreateResult>().toEqualTypeOf<{
    success: true;
    created: boolean;
  }>();
  expectTypeOf<WorkspaceRecoveryResult>().toEqualTypeOf<{
    success: true;
  }>();
});

it('publishes typed deck data and opt-in active-job polling', () => {
  expectTypeOf<UseDeckOptions>().toEqualTypeOf<{
    pollActiveJob?: boolean;
  }>();
  expectTypeOf<ReturnType<typeof useDeck>['data']>()
    .toEqualTypeOf<DeckDetailResponse | undefined>();
});
