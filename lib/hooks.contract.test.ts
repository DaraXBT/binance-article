import { expectTypeOf, it } from 'vitest';

import type {
  WorkspaceBootstrap,
  WorkspaceCreateResult,
  WorkspaceRecoveryResult,
} from './hooks';

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
