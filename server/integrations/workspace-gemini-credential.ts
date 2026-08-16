import type { AppDatabase } from '@/server/db/client';
import { AppError } from '@/server/http/app-error';
import { findWorkspaceAiCredential } from '@/server/modules/workspace/ai-credential-repository';
import {
  decryptWorkspaceAiCredential,
  parseAiCredentialKeyring,
} from '@/server/security/ai-credential-crypto';

export type GeminiCredentialSource = 'platform' | 'workspace';

export interface GeminiCredentialEnvironment extends Record<string, string | undefined> {
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_TEXT_MODEL?: string;
  GEMINI_MODEL?: string;
  GEMINI_IMAGE_MODEL?: string;
  AI_CREDENTIAL_KEYRING?: string;
  AI_CREDENTIAL_ACTIVE_KEY_ID?: string;
}

export interface ResolvedWorkspaceGeminiCredential {
  readonly provider: 'gemini';
  readonly source: GeminiCredentialSource;
  readonly apiKey: string;
}

const MIN_GEMINI_API_KEY_LENGTH = 20;
const MAX_GEMINI_API_KEY_LENGTH = 512;
const FORBIDDEN_API_KEY_CHARACTERS = /[\s\p{Cc}\p{Cf}]/u;

export class WorkspaceGeminiCredentialError extends AppError {
  readonly source: GeminiCredentialSource;

  constructor(source: GeminiCredentialSource, cause?: unknown) {
    super({
      code: source === 'workspace'
        ? 'WORKSPACE_GEMINI_CONNECTION_INVALID'
        : 'PLATFORM_GEMINI_UNAVAILABLE',
      message: source === 'workspace'
        ? 'Your Gemini connection needs attention. Test or replace your Gemini key in Connections, or switch to platform credits.'
        : 'The platform Gemini connection is unavailable. You can save and activate your Gemini key in Connections.',
      status: 503,
      cause,
    });
    this.name = 'WorkspaceGeminiCredentialError';
    this.source = source;
  }
}

export class GeminiApiKeyInputError extends AppError {
  constructor() {
    super({
      code: 'GEMINI_API_KEY_INVALID',
      message: 'The Gemini API key format is invalid.',
      status: 400,
    });
    this.name = 'GeminiApiKeyInputError';
  }
}

/**
 * Normalizes a transient Gemini key without ever retaining a mask, hash, or
 * suffix. Stored plaintext and incoming request values both pass this check.
 */
export function normalizeGeminiApiKey(
  value: string,
  context: 'input' | 'stored' = 'input',
): string {
  const normalized = value.trim();
  if (
    normalized.length < MIN_GEMINI_API_KEY_LENGTH
    || normalized.length > MAX_GEMINI_API_KEY_LENGTH
    || FORBIDDEN_API_KEY_CHARACTERS.test(normalized)
  ) {
    if (context === 'stored') throw new WorkspaceGeminiCredentialError('workspace');
    throw new GeminiApiKeyInputError();
  }
  return normalized;
}

function resolvePlatformKey(environment: GeminiCredentialEnvironment): string {
  const key = environment.GEMINI_API_KEY?.trim() || environment.GOOGLE_API_KEY?.trim();
  if (!key || key.length > MAX_GEMINI_API_KEY_LENGTH || FORBIDDEN_API_KEY_CHARACTERS.test(key)) {
    throw new WorkspaceGeminiCredentialError('platform');
  }
  return key;
}

export async function resolveWorkspaceGeminiCredential(input: {
  database: AppDatabase;
  workspaceId: string;
  environment?: GeminiCredentialEnvironment;
}): Promise<ResolvedWorkspaceGeminiCredential> {
  const environment = input.environment ?? process.env;
  let stored: Awaited<ReturnType<typeof findWorkspaceAiCredential>>;
  try {
    stored = await findWorkspaceAiCredential(input.database, input.workspaceId, 'gemini');
  } catch (error) {
    // A lookup that cannot establish the workspace state is not equivalent to
    // “no row”. Fail closed instead of risking a platform-key fallback.
    throw new WorkspaceGeminiCredentialError('workspace', error);
  }

  if (!stored?.enabled) {
    return {
      provider: 'gemini',
      source: 'platform',
      apiKey: resolvePlatformKey(environment),
    };
  }

  try {
    const keyringJson = environment.AI_CREDENTIAL_KEYRING;
    const activeKeyId = environment.AI_CREDENTIAL_ACTIVE_KEY_ID;
    if (!keyringJson || !activeKeyId) throw new Error('Missing credential keyring.');

    const keyring = await parseAiCredentialKeyring(keyringJson, activeKeyId);
    const plaintext = await decryptWorkspaceAiCredential({
      workspaceId: input.workspaceId,
      provider: 'gemini',
      ciphertext: stored.ciphertext,
      nonce: stored.nonce,
      encryptionKeyId: stored.encryptionKeyId,
      keyring,
    });

    return {
      provider: 'gemini',
      source: 'workspace',
      apiKey: normalizeGeminiApiKey(plaintext, 'stored'),
    };
  } catch (error) {
    if (error instanceof WorkspaceGeminiCredentialError) throw error;
    // An enabled workspace row is authoritative. Never fall back to the
    // platform key after a keyring, decrypt, AAD, or stored-value failure.
    throw new WorkspaceGeminiCredentialError('workspace', error);
  }
}
