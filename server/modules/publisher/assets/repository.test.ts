import { describe, expect, it, vi } from 'vitest';

import { createPublisherAssetRepository } from './repository';

describe('publisher asset repository', () => {
  it('authorizes assets only while both the assigned command and draft are unexpired', async () => {
    const captured: string[] = [];
    const client = vi.fn((strings: TemplateStringsArray) => {
      captured.push(strings.join('?'));
      return Promise.resolve([]);
    });
    const repository = createPublisherAssetRepository({ $client: client } as never);

    await repository.authorizeAsset({
      deviceId: 'device_1', commandId: 'command_1', assetId: 'asset_1',
    });

    expect(captured[0]).toMatch(/command\."expiresAt" > now\(\)/);
    expect(captured[0]).toMatch(/draft\."expiresAt" > now\(\)/);
  });
});
