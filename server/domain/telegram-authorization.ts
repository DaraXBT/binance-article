import { z } from 'zod';

export const TELEGRAM_APPROVAL_LIFETIME_MS = 2 * 60 * 1000;

const IdentifierSchema = z.string().trim().min(1).max(200);
const RevisionSchema = z.number().int().nonnegative().safe();
const TelegramChatTypeSchema = z.enum(['private', 'group', 'supergroup', 'channel']);

export const TelegramWebhookAuthorizationInputSchema = z.object({
  expectedWebhookSecret: z.string().min(1).max(256),
  presentedWebhookSecret: z.string().max(256),
  chatType: TelegramChatTypeSchema,
  telegramUserId: IdentifierSchema,
  linkedTelegramUserId: IdentifierSchema.nullable(),
  userStatus: z.enum(['active', 'suspended', 'revoked']),
  updateAlreadyProcessed: z.boolean(),
}).strict();

export type TelegramWebhookAuthorization =
  | { ok: true }
  | {
    ok: false;
    reason:
      | 'invalid_secret'
      | 'private_chat_required'
      | 'identity_mismatch'
      | 'user_suspended'
      | 'replayed_update';
  };

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function authorizeTelegramWebhook(
  input: z.input<typeof TelegramWebhookAuthorizationInputSchema>,
): TelegramWebhookAuthorization {
  const parsed = TelegramWebhookAuthorizationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_secret' };

  const authorization = parsed.data;
  if (!constantTimeEqual(authorization.expectedWebhookSecret, authorization.presentedWebhookSecret)) {
    return { ok: false, reason: 'invalid_secret' };
  }
  if (authorization.chatType !== 'private') return { ok: false, reason: 'private_chat_required' };
  if (authorization.telegramUserId !== authorization.linkedTelegramUserId) {
    return { ok: false, reason: 'identity_mismatch' };
  }
  if (authorization.userStatus !== 'active') return { ok: false, reason: 'user_suspended' };
  if (authorization.updateAlreadyProcessed) return { ok: false, reason: 'replayed_update' };
  return { ok: true };
}

export const PublishApprovalSchema = z.object({
  id: IdentifierSchema,
  state: z.enum(['pending', 'confirmation_required', 'approved', 'cancelled']),
  userId: IdentifierSchema,
  telegramUserId: IdentifierSchema,
  draftId: IdentifierSchema,
  revision: RevisionSchema,
  expiresAt: z.date(),
}).strict();

export const PublishApprovalEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request_confirmation'),
    telegramUserId: IdentifierSchema,
    draftId: IdentifierSchema,
    revision: RevisionSchema,
    chatType: TelegramChatTypeSchema,
  }).strict(),
  z.object({
    type: z.literal('confirm_publish'),
    telegramUserId: IdentifierSchema,
    draftId: IdentifierSchema,
    revision: RevisionSchema,
    chatType: TelegramChatTypeSchema,
  }).strict(),
]);

export type PublishApproval = z.infer<typeof PublishApprovalSchema>;
export type PublishApprovalEvent = z.infer<typeof PublishApprovalEventSchema>;

export function advancePublishApproval(
  approvalInput: PublishApproval,
  eventInput: PublishApprovalEvent,
  now = new Date(),
): PublishApproval {
  const approval = PublishApprovalSchema.parse(approvalInput);
  const event = PublishApprovalEventSchema.parse(eventInput);

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Publish approval transition requires a valid current time.');
  }
  if (approval.state === 'approved' || approval.state === 'cancelled') {
    throw new Error('Publish approval callback was already processed.');
  }
  if (!Number.isFinite(approval.expiresAt.getTime()) || approval.expiresAt.getTime() <= now.getTime()) {
    throw new Error('Publish approval has expired.');
  }
  if (event.chatType !== 'private') throw new Error('Publish approval requires a private Telegram chat.');
  if (event.telegramUserId !== approval.telegramUserId) throw new Error('Publish approval identity does not match.');
  if (event.draftId !== approval.draftId) throw new Error('Publish approval draft does not match.');
  if (event.revision !== approval.revision) throw new Error('Publish approval revision is stale.');

  if (approval.state === 'pending' && event.type === 'request_confirmation') {
    return { ...approval, state: 'confirmation_required' };
  }
  if (approval.state === 'confirmation_required' && event.type === 'confirm_publish') {
    return { ...approval, state: 'approved' };
  }

  throw new Error(`Invalid publish approval transition from ${approval.state} using ${event.type}.`);
}
