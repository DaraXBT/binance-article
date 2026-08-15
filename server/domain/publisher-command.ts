import { z } from 'zod';

import { PublicationKindSchema, PublicationTargetSchema } from './publication-recipe';

const IdentifierSchema = z.string().trim().min(1).max(200);
const RevisionSchema = z.number().int().nonnegative().safe();

export const PublisherCommandStateSchema = z.object({
  state: z.enum([
    'queued',
    'claimed',
    'awaiting_review',
    'awaiting_approval',
    'approved',
    'publishing',
    'succeeded',
    'failed',
    'cancelled',
    'expired',
    'outcome_unknown',
  ]),
  revision: RevisionSchema,
  target: PublicationTargetSchema.default('binance-square'),
  // Commands created before recipe V3 did not persist kind. Keeping this
  // optional here preserves their exact in-flight state while every V3
  // command carries an explicit value from preparation onward.
  kind: PublicationKindSchema.optional(),
  assignedDeviceId: IdentifierSchema.nullable(),
  expiresAt: z.date(),
  publishedUrl: z.string().url().optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
}).strict();

/**
 * Pre-publish transitions (claim, editor readiness, approval, cancel, expire)
 * are owned by the atomic SQL compare-and-swap statements in
 * server/modules/publisher; this pure function only validates the terminal
 * publish outcomes reported by a device — URL canonicalization, device match,
 * expiry, and revision — before the SQL transition is attempted.
 */
const PublisherCommandEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('publish_succeeded'),
    deviceId: IdentifierSchema,
    revision: RevisionSchema,
    publishedUrl: z.string().url(),
  }).strict(),
  z.object({
    type: z.literal('publish_failed'),
    deviceId: IdentifierSchema,
    revision: RevisionSchema,
    failureReason: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    type: z.literal('publish_outcome_unknown'),
    deviceId: IdentifierSchema,
    revision: RevisionSchema,
    failureReason: z.string().trim().min(1).max(500),
  }).strict(),
]);

export type PublisherCommandState = z.infer<typeof PublisherCommandStateSchema>;
export type PublisherCommandEvent = z.infer<typeof PublisherCommandEventSchema>;

const TERMINAL_STATES = new Set<PublisherCommandState['state']>([
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'outcome_unknown',
]);

function assertDevice(command: PublisherCommandState, deviceId: string): void {
  if (!command.assignedDeviceId || command.assignedDeviceId !== deviceId) {
    throw new Error('Publisher command belongs to a different device.');
  }
}

function assertPublishedUrl(
  target: z.infer<typeof PublicationTargetSchema>,
  kind: z.infer<typeof PublicationKindSchema> | undefined,
  value: string,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Published URL is not a valid ${target === 'x' ? 'X' : 'Binance'} URL.`);
  }

  const xValid = kind === 'article'
    ? /^https:\/\/x\.com\/i\/article\/[0-9]+$/.test(value)
    : /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+$/.test(value);
  const binanceMatch = value.match(
    /^https:\/\/(?:www\.)?binance\.com\/(?:[a-z]{2}\/)?square\/(post|article)\/[^/?#]+$/,
  );
  const binanceKindValid = Boolean(binanceMatch) && (
    kind === undefined || binanceMatch?.[1] === kind
  );
  const valid = target === 'x' ? xValid : binanceKindValid;
  if (!valid || url.username || url.password) {
    throw new Error(`Published URL is not a canonical ${target === 'x' ? 'X' : 'Binance Square'} URL.`);
  }
}

export function transitionPublisherCommand(
  commandInput: z.input<typeof PublisherCommandStateSchema>,
  eventInput: PublisherCommandEvent,
  now = new Date(),
): PublisherCommandState {
  const command = PublisherCommandStateSchema.parse(commandInput);
  const event = PublisherCommandEventSchema.parse(eventInput);

  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Publisher command transition requires a valid current time.');
  }
  if (TERMINAL_STATES.has(command.state)) {
    throw new Error(`Publisher command is already in terminal state ${command.state}.`);
  }
  if (!Number.isFinite(command.expiresAt.getTime()) || command.expiresAt.getTime() <= now.getTime()) {
    throw new Error('Publisher command has expired.');
  }
  if (event.revision !== command.revision) {
    throw new Error('Publisher command revision is stale.');
  }
  if (command.state !== 'publishing') {
    throw new Error(`Invalid publisher command transition from ${command.state} using ${event.type}.`);
  }
  assertDevice(command, event.deviceId);

  switch (event.type) {
    case 'publish_succeeded':
      assertPublishedUrl(command.target, command.kind, event.publishedUrl);
      return { ...command, state: 'succeeded', publishedUrl: event.publishedUrl };

    case 'publish_failed':
      return { ...command, state: 'failed', failureReason: event.failureReason };

    case 'publish_outcome_unknown':
      return { ...command, state: 'outcome_unknown', failureReason: event.failureReason };
  }
}
