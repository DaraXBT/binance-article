import { createDatabase, type AppDatabase } from '@/server/db/client';
import { createTelegramMetadataRepository } from '@/server/modules/telegram/metadata-repository';
import { createTelegramUpdateRepository } from '@/server/modules/telegram/update-repository';
import { handleTelegramWebhook } from '@/server/modules/telegram/update-service';

import { executeTelegramUpdate } from './bot';
import { parseTelegramEnvironment, type TelegramWorkerEnvironment } from './environment';

export default {
  async fetch(request: Request, rawEnvironment: TelegramWorkerEnvironment): Promise<Response> {
    let environment: ReturnType<typeof parseTelegramEnvironment>;
    try {
      environment = parseTelegramEnvironment(rawEnvironment);
    } catch {
      return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }

    let database: AppDatabase | undefined;
    const getDatabase = () => {
      database ??= createDatabase(environment.databaseUrl);
      return database;
    };

    return handleTelegramWebhook({
      request,
      expectedWebhookSecret: environment.webhookSecret,
      botId: String(environment.botInfo.id),
      repositoryFactory: () => createTelegramUpdateRepository(getDatabase()),
      executeUpdate: ({ update, actor }) => executeTelegramUpdate({
        update,
        actor,
        token: environment.botToken,
        botInfo: environment.botInfo,
        repository: createTelegramMetadataRepository(getDatabase()),
        appBaseUrl: environment.appBaseUrl,
      }),
    });
  },
};
