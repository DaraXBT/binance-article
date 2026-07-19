import { z } from 'zod';

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
    'outcome_unknown',
  ]),
  revision: RevisionSchema,
  assignedDeviceId: IdentifierSchema.nullable(),
  expiresAt: z.date(),
  publishedUrl: z.string().url().optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
}).strict();

const PublisherCommandEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claim'), deviceId: IdentifierSchema, revision: RevisionSchema }).strict(),
  z.object({ type: z.literal('editor_filled'), deviceId: IdentifierSchema, revision: RevisionSchema }).strict(),
  z.object({ type: z.literal('request_approval'), revision: RevisionSchema }).strict(),
  z.object({ type: z.literal('approve'), revision: RevisionSchema }).strict(),
  z.object({ type: z.literal('begin_publish'), deviceId: IdentifierSchema, revision: RevisionSchema }).strict(),
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
  z.object({ type: z.literal('cancel'), revision: RevisionSchema }).strict(),
]);

export type PublisherCommandState = z.infer<typeof PublisherCommandStateSchema>;
export type PublisherCommandEvent = z.infer<typeof PublisherCommandEventSchema>;

const TERMINAL_STATES = new Set<PublisherCommandState['state']>([
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
]);

function assertDevice(command: PublisherCommandState, deviceId: string): void {
  if (!command.assignedDeviceId || command.assignedDeviceId !== deviceId) {
    throw new Error('Publisher command belongs to a different device.');
  }
}

function assertBinancePublishedUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Published URL is not a valid Binance URL.');
  }

  const isBinanceHost = url.hostname === 'binance.com' || url.hostname.endsWith('.binance.com');
  const isPublishedPath = /\/square\/(?:post|article)\/[^/]+/i.test(url.pathname);
  if (url.protocol !== 'https:' || !isBinanceHost || !isPublishedPath || url.username || url.password) {
    throw new Error('Published URL is not a canonical Binance Square URL.');
  }
}

function assertTransition(
  command: PublisherCommandState,
  event: PublisherCommandEvent,
  from: PublisherCommandState['state'],
): void {
  if (command.state !== from) {
    throw new Error(`Invalid publisher command transition from ${command.state} using ${event.type}.`);
  }
}

export function transitionPublisherCommand(
  commandInput: PublisherCommandState,
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

  switch (event.type) {
    case 'claim':
      assertTransition(command, event, 'queued');
      if (command.assignedDeviceId !== null) {
        throw new Error('Queued publisher command is already assigned to a device.');
      }
      return { ...command, state: 'claimed', assignedDeviceId: event.deviceId };

    case 'editor_filled':
      assertTransition(command, event, 'claimed');
      assertDevice(command, event.deviceId);
      return { ...command, state: 'awaiting_review' };

    case 'request_approval':
      assertTransition(command, event, 'awaiting_review');
      if (!command.assignedDeviceId) throw new Error('Publisher command has no assigned device.');
      return { ...command, state: 'awaiting_approval' };

    case 'approve':
      assertTransition(command, event, 'awaiting_approval');
      return { ...command, state: 'approved' };

    case 'begin_publish':
      assertTransition(command, event, 'approved');
      assertDevice(command, event.deviceId);
      return { ...command, state: 'publishing' };

    case 'publish_succeeded':
      assertTransition(command, event, 'publishing');
      assertDevice(command, event.deviceId);
      assertBinancePublishedUrl(event.publishedUrl);
      return { ...command, state: 'succeeded', publishedUrl: event.publishedUrl };

    case 'publish_failed':
      assertTransition(command, event, 'publishing');
      assertDevice(command, event.deviceId);
      return { ...command, state: 'failed', failureReason: event.failureReason };

    case 'publish_outcome_unknown':
      assertTransition(command, event, 'publishing');
      assertDevice(command, event.deviceId);
      return { ...command, state: 'outcome_unknown', failureReason: event.failureReason };

    case 'cancel':
      return { ...command, state: 'cancelled' };
  }
}
