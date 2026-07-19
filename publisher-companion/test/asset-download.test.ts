import { describe, expect, it, mock } from 'bun:test';

import { downloadVerifiedAsset, sha256Hex } from '../src/asset-download';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('publisher asset download integrity', () => {
  it('requires matching headers, bounded bytes, magic signature, and actual SHA-256', async () => {
    const hash = await sha256Hex(png);
    const api = {
      downloadAsset: mock(async () => new Response(png, { headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'X-Content-SHA256': hash,
      } })),
    };

    await expect(downloadVerifiedAsset({
      api, commandId: 'command_1',
      asset: { id: 'asset_1', mimeType: 'image/png', sizeBytes: png.byteLength, sha256: hash },
    })).resolves.toEqual(png);
  });

  it.each([
    ['missing length', { 'Content-Type': 'image/png', 'X-Content-SHA256': 'HASH' }],
    ['wrong MIME', { 'Content-Type': 'image/jpeg', 'Content-Length': String(png.byteLength), 'X-Content-SHA256': 'HASH' }],
    ['wrong length', { 'Content-Type': 'image/png', 'Content-Length': '999', 'X-Content-SHA256': 'HASH' }],
    ['wrong hash header', { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength), 'X-Content-SHA256': 'b'.repeat(64) }],
  ])('fails closed for %s', async (_label, inputHeaders) => {
    const hash = await sha256Hex(png);
    const headers = Object.fromEntries(Object.entries(inputHeaders).map(([key, value]) => [
      key, value === 'HASH' ? hash : value,
    ]));
    await expect(downloadVerifiedAsset({
      api: { downloadAsset: async () => new Response(png, { headers }) },
      commandId: 'command_1',
      asset: { id: 'asset_1', mimeType: 'image/png', sizeBytes: png.byteLength, sha256: hash },
    })).rejects.toThrow(/integrity/i);
  });

  it('rejects a stream that exceeds immutable metadata before buffering more data', async () => {
    const hash = await sha256Hex(png);
    const oversized = new Uint8Array([...png, 4]);
    await expect(downloadVerifiedAsset({
      api: { downloadAsset: async () => new Response(oversized, { headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'X-Content-SHA256': hash,
      } }) },
      commandId: 'command_1',
      asset: { id: 'asset_1', mimeType: 'image/png', sizeBytes: png.byteLength, sha256: hash },
    })).rejects.toThrow(/integrity/i);
  });
});
