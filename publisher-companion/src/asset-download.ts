import { z } from 'zod';

const AssetSchema = z.object({
  id: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function sniffImageMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder('ascii').decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('Publisher asset integrity verification failed.');
}

function equalHash(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function readExactBody(response: Response, expectedBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Publisher asset integrity verification failed.');
  const output = new Uint8Array(expectedBytes);
  const reader = response.body.getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > expectedBytes) {
      await reader.cancel();
      throw new Error('Publisher asset integrity verification failed.');
    }
    output.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== expectedBytes) throw new Error('Publisher asset integrity verification failed.');
  return output;
}

export async function downloadVerifiedAsset(input: {
  api: { downloadAsset(commandId: string, assetId: string): Promise<Response> };
  commandId: string;
  asset: unknown;
}): Promise<Uint8Array> {
  const asset = AssetSchema.parse(input.asset);
  const response = await input.api.downloadAsset(input.commandId, asset.id);
  const declaredLength = response.headers.get('content-length');
  const declaredMime = response.headers.get('content-type');
  const declaredHash = response.headers.get('x-content-sha256');
  const contentEncoding = response.headers.get('content-encoding');
  if (
    declaredLength !== String(asset.sizeBytes)
    || declaredMime !== asset.mimeType
    || !declaredHash
    || !equalHash(declaredHash, asset.sha256)
    || (contentEncoding !== null && contentEncoding !== 'identity')
  ) {
    throw new Error('Publisher asset integrity verification failed.');
  }

  const bytes = await readExactBody(response, asset.sizeBytes);
  const actualHash = await sha256Hex(bytes);
  if (!equalHash(actualHash, asset.sha256) || sniffImageMimeType(bytes) !== asset.mimeType) {
    throw new Error('Publisher asset integrity verification failed.');
  }
  return bytes;
}
