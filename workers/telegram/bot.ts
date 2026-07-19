import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

import type { TelegramActor, TelegramUpdate } from '@/server/modules/telegram/update-service';

export type TelegramBotInfo = Pick<
  UserFromGetMe,
  'id' | 'is_bot' | 'first_name' | 'username'
>;

export interface TelegramMetadataRepository {
  listArticles(userId: string): Promise<Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
  }>>;
  listStatuses(userId: string): Promise<Array<{
    id: string;
    kind: string;
    status: string;
    progress: number | null;
    errorCode: string | null;
    updatedAt: Date;
  }>>;
  listDevices(userId: string): Promise<Array<{
    id: string;
    name: string;
    status: string;
    protocolVersion: number;
    pairedAt: Date | null;
    lastSeenAt: Date | null;
  }>>;
  getAdminOverview(userId: string): Promise<{
    activeUsers: number;
    pendingInvitations: number;
    activeDevices: number;
  }>;
}

function clean(value: string, maxLength = 120): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function commandName(text: string): string {
  return text.trim().match(/^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase() ?? '';
}

const HELP = [
  'Binance Square publisher commands:',
  '/articles — recent article metadata',
  '/new — open the private web editor',
  '/status — recent job and publication states',
  '/devices — paired publisher device status',
  '/help — show this help',
].join('\n');

export async function dispatchTelegramCommand(input: {
  text: string;
  actor: TelegramActor;
  repository: TelegramMetadataRepository;
  appBaseUrl: string;
}): Promise<string> {
  const command = commandName(input.text);
  switch (command) {
    case 'start':
    case 'help':
      return HELP;

    case 'new':
      return `Create an article in the private web app:\n${input.appBaseUrl}/new`;

    case 'articles': {
      const articles = await input.repository.listArticles(input.actor.id);
      if (articles.length === 0) return 'No articles found.';
      return articles.map((article) => [
        `${clean(article.title)} — ${clean(article.status, 40)} — ${article.updatedAt.toISOString()}`,
        `${input.appBaseUrl}/articles/${encodeURIComponent(article.id)}`,
      ].join('\n')).join('\n\n').slice(0, 3_800);
    }

    case 'status': {
      const statuses = await input.repository.listStatuses(input.actor.id);
      if (statuses.length === 0) return 'No recent jobs or publications.';
      return statuses.map((status) => {
        const progress = status.progress === null ? '' : ` — ${status.progress}%`;
        const errorCode = status.errorCode ? ` — ${clean(status.errorCode, 60)}` : '';
        return `${clean(status.kind, 60)} — ${clean(status.status, 40)}${progress}${errorCode}`;
      }).join('\n').slice(0, 3_800);
    }

    case 'devices': {
      const devices = await input.repository.listDevices(input.actor.id);
      if (devices.length === 0) return 'No publisher devices paired.';
      return devices.map((device) => {
        const seen = device.lastSeenAt ? device.lastSeenAt.toISOString() : 'never online';
        return `${clean(device.name, 80)} — ${clean(device.status, 30)} — protocol ${device.protocolVersion} — last seen ${seen}`;
      }).join('\n').slice(0, 3_800);
    }

    case 'admin': {
      if (input.actor.role !== 'owner') return 'Owner access is required.';
      const overview = await input.repository.getAdminOverview(input.actor.id);
      return [
        'Private beta overview:',
        `Active users: ${overview.activeUsers}`,
        `Pending invitations: ${overview.pendingInvitations}`,
        `Active devices: ${overview.activeDevices}`,
        `${input.appBaseUrl}/admin`,
      ].join('\n');
    }

    default:
      return HELP;
  }
}

export function createTelegramBot(input: {
  token: string;
  botInfo: TelegramBotInfo;
  actor: TelegramActor;
  repository: TelegramMetadataRepository;
  appBaseUrl: string;
}) {
  const botInfo: UserFromGetMe = {
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
    ...input.botInfo,
  };
  const bot = new Bot(input.token, { botInfo });
  bot.on('message:text', async (context) => {
    const reply = await dispatchTelegramCommand({
      text: context.message.text,
      actor: input.actor,
      repository: input.repository,
      appBaseUrl: input.appBaseUrl,
    });
    await context.reply(reply);
  });
  return bot;
}

export async function executeTelegramUpdate(input: {
  update: TelegramUpdate;
  actor: TelegramActor;
  token: string;
  botInfo: TelegramBotInfo;
  repository: TelegramMetadataRepository;
  appBaseUrl: string;
}) {
  const bot = createTelegramBot(input);
  await bot.handleUpdate(input.update as never);
}
