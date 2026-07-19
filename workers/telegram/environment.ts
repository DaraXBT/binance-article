import { z } from 'zod';

const BotInfoSchema = z.object({
  id: z.number().int().positive().safe(),
  is_bot: z.literal(true),
  first_name: z.string().trim().min(1).max(64),
  username: z.string().trim().min(5).max(64),
}).passthrough();

const EnvironmentSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  TELEGRAM_BOT_INFO: z.string().min(1),
  APP_BASE_URL: z.string().url(),
}).passthrough();

export interface TelegramWorkerEnvironment {
  DATABASE_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_INFO: string;
  APP_BASE_URL: string;
}

export function parseTelegramEnvironment(input: TelegramWorkerEnvironment) {
  const environment = EnvironmentSchema.parse(input);
  const botInfo = BotInfoSchema.parse(JSON.parse(environment.TELEGRAM_BOT_INFO));
  const appBaseUrl = new URL(environment.APP_BASE_URL);
  if (appBaseUrl.protocol !== 'https:' || appBaseUrl.username || appBaseUrl.password) {
    throw new Error('APP_BASE_URL must be a credential-free HTTPS URL.');
  }
  appBaseUrl.pathname = '/';
  appBaseUrl.search = '';
  appBaseUrl.hash = '';

  return {
    databaseUrl: environment.DATABASE_URL,
    botToken: environment.TELEGRAM_BOT_TOKEN,
    webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET,
    botInfo,
    appBaseUrl: appBaseUrl.origin,
  };
}
