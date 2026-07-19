import { AppError } from './errors';

function bodyError(code: string, message: string, status: number): AppError {
  return new AppError({ code, message, status });
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('The JSON body limit must be a positive safe integer.');
  }

  const declaredHeader = request.headers.get('content-length');
  if (declaredHeader !== null) {
    const declaredLength = Number(declaredHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw bodyError('INVALID_CONTENT_LENGTH', 'The request body is invalid.', 400);
    }
    if (declaredLength > maxBytes) {
      throw bodyError('REQUEST_BODY_TOO_LARGE', 'The request body is too large.', 413);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw bodyError('INVALID_JSON_BODY', 'The request body must be valid JSON.', 400);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw bodyError('REQUEST_BODY_TOO_LARGE', 'The request body is too large.', 413);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw bodyError('INVALID_JSON_BODY', 'The request body must be valid JSON.', 400);
  } finally {
    reader.releaseLock();
  }
}
