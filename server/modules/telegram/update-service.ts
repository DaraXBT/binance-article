import { z } from 'zod';

import { authorizeTelegramWebhook } from '@/server/domain/telegram-authorization';

const MAX_TELEGRAM_UPDATE_BYTES = 128 * 1024;

const TelegramUserSchema = z.object({
  id: z.number().int().safe(),
}).passthrough();

const TelegramChatSchema = z.object({
  id: z.number().int().safe(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
}).passthrough();

const TelegramMessageSchema = z.object({
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
}).passthrough();

const TelegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: TelegramMessageSchema.optional(),
  callback_query: z.object({
    from: TelegramUserSchema,
    message: TelegramMessageSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export interface TelegramActor {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'revoked';
  role: 'owner' | 'user';
  telegramUserId: string;
}

export type TelegramUpdateClaim =
  | { kind: 'claimed'; actor: TelegramActor | null }
  | { kind: 'duplicate' }
  | { kind: 'replay_anomaly' };

export interface TelegramUpdateRepository {
  claimUpdate(input: {
    botId: string;
    updateId: number;
    telegramUserId: string | null;
    payloadHash: string;
    now: Date;
  }): Promise<TelegramUpdateClaim>;
  completeUpdate(input: {
    botId: string;
    updateId: number;
    status: 'processed' | 'rejected' | 'failed';
    errorCode: string | null;
    now: Date;
  }): Promise<boolean>;
}

function response(status: number, headers?: HeadersInit) {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_TELEGRAM_UPDATE_BYTES) {
    throw new RangeError('TELEGRAM_UPDATE_TOO_LARGE');
  }
  if (!request.body) throw new TypeError('TELEGRAM_UPDATE_INVALID');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_TELEGRAM_UPDATE_BYTES) {
      await reader.cancel();
      throw new RangeError('TELEGRAM_UPDATE_TOO_LARGE');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function identityFromUpdate(update: TelegramUpdate) {
  if (update.message?.from) {
    return {
      telegramUserId: String(update.message.from.id),
      chatType: update.message.chat.type,
    };
  }
  if (update.callback_query?.message) {
    return {
      telegramUserId: String(update.callback_query.from.id),
      chatType: update.callback_query.message.chat.type,
    };
  }
  return null;
}

const rejectionCode = {
  invalid_secret: 'INVALID_WEBHOOK_SECRET',
  private_chat_required: 'PRIVATE_CHAT_REQUIRED',
  identity_mismatch: 'TELEGRAM_IDENTITY_NOT_LINKED',
  user_suspended: 'ACCOUNT_DISABLED',
  replayed_update: 'REPLAYED_UPDATE',
} as const;

export async function handleTelegramWebhook(input: {
  request: Request;
  expectedWebhookSecret: string;
  botId: string;
  repositoryFactory: () => TelegramUpdateRepository;
  executeUpdate: (input: { update: TelegramUpdate; actor: TelegramActor }) => Promise<void>;
  now?: Date;
}): Promise<Response> {
  const url = new URL(input.request.url);
  if (url.pathname !== '/webhook') return response(404);
  if (input.request.method !== 'POST') return response(405, { Allow: 'POST' });

  const presentedSecret = input.request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!constantTimeEqual(input.expectedWebhookSecret, presentedSecret)) return response(401);
  if (!input.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return response(415);
  }

  let rawBody: Uint8Array;
  let update: TelegramUpdate;
  try {
    rawBody = await readBoundedBody(input.request);
    update = TelegramUpdateSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)));
  } catch (error) {
    return response(error instanceof RangeError ? 413 : 400);
  }

  const now = input.now ?? new Date();
  const identity = identityFromUpdate(update);
  const repository = input.repositoryFactory();
  let claim: TelegramUpdateClaim;
  try {
    claim = await repository.claimUpdate({
      botId: input.botId,
      updateId: update.update_id,
      telegramUserId: identity?.telegramUserId ?? null,
      payloadHash: await sha256Hex(rawBody),
      now,
    });
  } catch {
    return response(503);
  }

  if (claim.kind !== 'claimed') return response(200);
  const authorization = identity
    ? authorizeTelegramWebhook({
      expectedWebhookSecret: input.expectedWebhookSecret,
      presentedWebhookSecret: presentedSecret,
      chatType: identity.chatType,
      telegramUserId: identity.telegramUserId,
      linkedTelegramUserId: claim.actor?.telegramUserId ?? null,
      userStatus: claim.actor?.status ?? 'revoked',
      updateAlreadyProcessed: false,
    })
    : { ok: false as const, reason: 'identity_mismatch' as const };

  if (!authorization.ok || !claim.actor) {
    const reason = authorization.ok ? 'identity_mismatch' : authorization.reason;
    await repository.completeUpdate({
      botId: input.botId,
      updateId: update.update_id,
      status: 'rejected',
      errorCode: rejectionCode[reason],
      now,
    });
    return response(200);
  }

  try {
    await input.executeUpdate({ update, actor: claim.actor });
    await repository.completeUpdate({
      botId: input.botId,
      updateId: update.update_id,
      status: 'processed',
      errorCode: null,
      now,
    });
  } catch {
    await repository.completeUpdate({
      botId: input.botId,
      updateId: update.update_id,
      status: 'failed',
      errorCode: 'COMMAND_EXECUTION_FAILED',
      now,
    });
  }
  return response(200);
}
