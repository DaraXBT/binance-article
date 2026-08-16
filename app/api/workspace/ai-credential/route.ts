import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getImageModel } from '@/lib/image-gen';
import {
  validateGeminiApiKey,
  GeminiRestError,
} from '@/server/integrations/gemini-rest';
import { normalizeGeminiApiKey } from '@/server/integrations/workspace-gemini-credential';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { AppError } from '@/server/http/app-error';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import {
  createWorkspaceAiCredentialRepository,
  type WorkspaceAiCredentialRecord,
} from '@/server/modules/workspace/ai-credential-repository';
import { requireActorWorkspaceOwner } from '@/server/modules/workspace/membership';
import {
  encryptWorkspaceAiCredential,
  parseAiCredentialKeyring,
  decryptWorkspaceAiCredential,
} from '@/server/security/ai-credential-crypto';

export const maxDuration = 30;

const PROVIDER = 'gemini' as const;
const BODY_LIMIT_BYTES = 2 * 1024;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1_000;
const SourceSchema = z.enum(['platform', 'workspace']);
const EmptyBodySchema = z.object({}).strict();
const ApiKeyBodySchema = z.object({
  apiKey: z.string().trim().min(20).max(512),
}).strict();
const SourceBodySchema = z.object({ source: SourceSchema }).strict();

type CredentialStatus = {
  provider: 'gemini';
  configured: boolean;
  activeSource: 'platform' | 'workspace';
  validatedAt: string | null;
  updatedAt: string | null;
};

type RouteFallback = { code: string; message: string; status: number };

function credentialErrorResponse(error: unknown, fallback: RouteFallback) {
  const safeError = error instanceof AppError || error instanceof z.ZodError
    ? error
    : new AppError({ ...fallback, cause: error });
  return errorResponse(safeError, fallback);
}

function statusFromRecord(record: WorkspaceAiCredentialRecord | null): CredentialStatus {
  return {
    provider: PROVIDER,
    configured: Boolean(record),
    activeSource: record?.enabled ? 'workspace' : 'platform',
    validatedAt: record?.validatedAt?.toISOString() ?? null,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  };
}

function credentialEnvironment() {
  return process.env as Record<string, string | undefined>;
}

function providerModels(environment: Record<string, string | undefined>) {
  const text = environment.GEMINI_TEXT_MODEL?.trim() ||
    environment.GEMINI_MODEL?.trim() ||
    'gemini-2.5-flash';
  const image = getImageModel(environment);
  return { textModel: text, imageModel: image };
}

function providerValidationError(error: unknown): AppError {
  const status = error instanceof GeminiRestError ? error.statusCode : 502;
  return new AppError({
    code: 'GEMINI_CREDENTIAL_INVALID',
    message: 'The Gemini key could not be validated. Check the key and enabled Gemini models, then try again.',
    status: status === 429 ? 429 : status >= 500 ? 503 : 400,
    cause: error,
  });
}

async function requireOwnerContext(request: NextRequest) {
  const actor = await requireActiveUser(request);
  const database = getRuntimeDatabase();
  const workspace = await requireActorWorkspaceOwner(database, actor.id);
  return { actor, database, workspace };
}

async function consumeCredentialRateLimit(
  database: ReturnType<typeof getRuntimeDatabase>,
  actorId: string,
  workspaceId: string,
) {
  const now = new Date();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${workspaceId}:${actorId}`),
  );
  const scope = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = await consumeAtomicRateLimit({
    database,
    key: `workspace-ai-credential:${scope}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
    now,
  });
  if (!result.allowed) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: 'Gemini connection rate limit exceeded. Please try again later.',
      status: 429,
    });
  }
}

async function keyringFromEnvironment() {
  const environment = credentialEnvironment();
  if (!environment.AI_CREDENTIAL_KEYRING || !environment.AI_CREDENTIAL_ACTIVE_KEY_ID) {
    throw new AppError({
      code: 'AI_CREDENTIAL_STORAGE_UNAVAILABLE',
      message: 'Gemini connections are not available yet.',
      status: 503,
    });
  }
  try {
    return await parseAiCredentialKeyring(
      environment.AI_CREDENTIAL_KEYRING,
      environment.AI_CREDENTIAL_ACTIVE_KEY_ID,
    );
  } catch (error) {
    throw new AppError({
      code: 'AI_CREDENTIAL_STORAGE_UNAVAILABLE',
      message: 'Gemini connections are not available yet.',
      status: 503,
      cause: error,
    });
  }
}

async function validateKey(apiKey: string) {
  const environment = credentialEnvironment();
  const models = providerModels(environment);
  try {
    await validateGeminiApiKey({
      apiKey,
      ...models,
    });
  } catch (error) {
    throw providerValidationError(error);
  }
}

async function credentialStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // PostgreSQL constraint errors can include a failing row. Replace them
    // before the shared API logger sees the error so encrypted fields and key
    // IDs never enter observability output.
    throw new AppError({
      code: 'AI_CREDENTIAL_STORAGE_FAILED',
      message: 'The Gemini connection could not be stored.',
      status: 500,
      cause: error,
    });
  }
}

async function readOptionalBoundedMutationBody(request: NextRequest): Promise<void> {
  const declaredLength = request.headers.get('content-length');
  if (!request.body && (declaredLength === null || /^0+$/.test(declaredLength))) return;
  EmptyBodySchema.parse(await readBoundedJson(request, BODY_LIMIT_BYTES));
}

export async function GET(request: NextRequest) {
  try {
    const { actor, database, workspace } = await requireOwnerContext(request);
    const repository = createWorkspaceAiCredentialRepository(database);
    const record = await credentialStorageOperation(() => repository.findOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
    }));
    return NextResponse.json(statusFromRecord(record), { headers: withNoStoreHeaders() });
  } catch (error) {
    return credentialErrorResponse(error, {
      code: 'AI_CREDENTIAL_FETCH_FAILED',
      message: 'Failed to fetch Gemini connection.',
      status: 500,
    });
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const { actor, database, workspace } = await requireOwnerContext(request);
    const body = await readBoundedJson(request, BODY_LIMIT_BYTES);
    const parsed = ApiKeyBodySchema.parse(body);
    const apiKey = normalizeGeminiApiKey(parsed.apiKey);
    await consumeCredentialRateLimit(database, actor.id, workspace.id);
    const keyring = await keyringFromEnvironment();
    await validateKey(apiKey);
    const encrypted = await encryptWorkspaceAiCredential({
      plaintext: apiKey,
      workspaceId: workspace.id,
      provider: PROVIDER,
      keyring,
    });
    const now = new Date();
    const repository = createWorkspaceAiCredentialRepository(database);
    const saved = await credentialStorageOperation(() => repository.saveOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
      credentialId: crypto.randomUUID(),
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionKeyId: encrypted.encryptionKeyId,
      validatedAt: now,
      auditEventId: crypto.randomUUID(),
      now,
    }));
    if (!saved) {
      throw new AppError({
        code: 'WORKSPACE_OWNER_REQUIRED',
        message: 'Gemini settings are unavailable for this account.',
        status: 403,
      });
    }
    return NextResponse.json(statusFromRecord(saved.record), { headers: withNoStoreHeaders() });
  } catch (error) {
    return credentialErrorResponse(error, {
      code: 'AI_CREDENTIAL_SAVE_FAILED',
      message: 'Failed to save Gemini connection.',
      status: 500,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const { actor, database, workspace } = await requireOwnerContext(request);
    await readOptionalBoundedMutationBody(request);
    const repository = createWorkspaceAiCredentialRepository(database);
    const record = await credentialStorageOperation(() => repository.findOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
    }));
    if (!record) {
      throw new AppError({
        code: 'AI_CREDENTIAL_NOT_CONFIGURED',
        message: 'Save your Gemini key before testing it.',
        status: 409,
      });
    }
    await consumeCredentialRateLimit(database, actor.id, workspace.id);
    const keyring = await keyringFromEnvironment();
    let apiKey: string;
    try {
      apiKey = normalizeGeminiApiKey(await decryptWorkspaceAiCredential({
        workspaceId: workspace.id,
        provider: PROVIDER,
        ciphertext: record.ciphertext,
        nonce: record.nonce,
        encryptionKeyId: record.encryptionKeyId,
        keyring,
      }), 'stored');
    } catch (error) {
      throw new AppError({
        code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
        message: 'Your Gemini connection needs attention. Replace the key or switch to platform credits.',
        status: 503,
        cause: error,
      });
    }
    await validateKey(apiKey);
    const now = new Date();
    const updated = await credentialStorageOperation(() => repository.recordValidationOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
      credentialId: record.id,
      expectedUpdatedAt: record.updatedAt,
      validatedAt: now,
      now,
    }));
    if (!updated) {
      throw new AppError({
        code: 'AI_CREDENTIAL_CONFLICT',
        message: 'The Gemini connection changed while this request was running. Refresh and try again.',
        status: 409,
      });
    }
    return NextResponse.json(statusFromRecord(updated), { headers: withNoStoreHeaders() });
  } catch (error) {
    return credentialErrorResponse(error, {
      code: 'AI_CREDENTIAL_TEST_FAILED',
      message: 'Failed to test Gemini connection.',
      status: 500,
    });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const { actor, database, workspace } = await requireOwnerContext(request);
    const body = await readBoundedJson(request, BODY_LIMIT_BYTES);
    const { source } = SourceBodySchema.parse(body);
    const repository = createWorkspaceAiCredentialRepository(database);
    const current = await credentialStorageOperation(() => repository.findOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
    }));
    if (source === 'workspace') {
      if (!current) {
        throw new AppError({
          code: 'AI_CREDENTIAL_NOT_CONFIGURED',
          message: 'Save and test your Gemini key before activating it.',
          status: 409,
        });
      }
      await consumeCredentialRateLimit(database, actor.id, workspace.id);
      const keyring = await keyringFromEnvironment();
      let apiKey: string;
      try {
        apiKey = normalizeGeminiApiKey(await decryptWorkspaceAiCredential({
          workspaceId: workspace.id,
          provider: PROVIDER,
          ciphertext: current.ciphertext,
          nonce: current.nonce,
          encryptionKeyId: current.encryptionKeyId,
          keyring,
        }), 'stored');
      } catch (error) {
        throw new AppError({
          code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
          message: 'Your Gemini connection needs attention. Replace the key or switch to platform credits.',
          status: 503,
          cause: error,
        });
      }
      await validateKey(apiKey);
    }
    const now = new Date();
    if (!current) return NextResponse.json(statusFromRecord(null), { headers: withNoStoreHeaders() });
    const changed = await credentialStorageOperation(() => repository.changeSourceOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
      credentialId: current.id,
      expectedUpdatedAt: current.updatedAt,
      source,
      validatedAt: source === 'workspace' ? now : undefined,
      auditEventId: crypto.randomUUID(),
      now,
    }));
    if (!changed) {
      throw new AppError({
        code: 'AI_CREDENTIAL_CONFLICT',
        message: 'The Gemini connection changed while this request was running. Refresh and try again.',
        status: 409,
      });
    }
    return NextResponse.json(statusFromRecord(changed.record), { headers: withNoStoreHeaders() });
  } catch (error) {
    return credentialErrorResponse(error, {
      code: 'AI_CREDENTIAL_SOURCE_CHANGE_FAILED',
      message: 'Failed to change Gemini source.',
      status: 500,
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const { actor, database, workspace } = await requireOwnerContext(request);
    await readOptionalBoundedMutationBody(request);
    const repository = createWorkspaceAiCredentialRepository(database);
    await credentialStorageOperation(() => repository.deleteOwned({
      actorUserId: actor.id,
      workspaceId: workspace.id,
      provider: PROVIDER,
      auditEventId: crypto.randomUUID(),
      now: new Date(),
    }));
    return NextResponse.json(statusFromRecord(null), { headers: withNoStoreHeaders() });
  } catch (error) {
    return credentialErrorResponse(error, {
      code: 'AI_CREDENTIAL_DELETE_FAILED',
      message: 'Failed to delete Gemini connection.',
      status: 500,
    });
  }
}
