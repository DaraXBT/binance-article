import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';

import { cropBinanceCover } from '../src/crop';

describe('local Binance cover crop', () => {
  it('normalizes and produces an exact 1000x400 JPEG around the focal point', async () => {
    const source = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: { r: 20, g: 100, b: 200 } },
    }).png().toBuffer();

    const cover = await cropBinanceCover({ bytes: source, focalX: 0.75, focalY: 0.25 });
    const metadata = await sharp(cover).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1000);
    expect(metadata.height).toBe(400);
  });

  it('rejects images over the decode pixel ceiling', async () => {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 3, background: 'red' },
    }).png().toBuffer();
    await expect(cropBinanceCover({
      bytes: source, focalX: 0.5, focalY: 0.5, maxInputPixels: 100,
    })).rejects.toThrow();
  });
});
