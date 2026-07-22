import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/server/integrations/gemini-rest', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/integrations/gemini-rest')>();
  return { ...original, generateGeminiContent: provider.generate };
});

import { generateImage } from './image-gen';

describe('image generation output settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.generate.mockResolvedValue({
      candidates: [{ content: { parts: [{
        inlineData: { data: Buffer.from('image').toString('base64'), mimeType: 'image/png' },
      }] } }],
    });
  });

  it('keeps slides at 16:9/1K by default', async () => {
    await generateImage('slide prompt', { apiKey: 'key', model: 'model' });
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      generationConfig: expect.objectContaining({
        imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
      }),
    }));
  });

  it('requests the wide 2K source used by dedicated covers', async () => {
    await generateImage('cover prompt', { apiKey: 'key', model: 'model' }, {
      aspectRatio: '21:9',
      imageSize: '2K',
    });
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      generationConfig: expect.objectContaining({
        imageConfig: { aspectRatio: '21:9', imageSize: '2K' },
      }),
    }));
  });
});
