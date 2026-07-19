import { describe, expect, it } from 'vitest';

import { readBoundedJson } from './request-body';

describe('bounded JSON request bodies', () => {
  it('parses a JSON object below the byte limit', async () => {
    const request = new Request('https://articles.example.com/api/test', {
      method: 'POST',
      body: JSON.stringify({ value: 'ok' }),
    });
    await expect(readBoundedJson(request, 64)).resolves.toEqual({ value: 'ok' });
  });

  it('rejects a declared or streamed body over the byte limit', async () => {
    const declared = new Request('https://articles.example.com/api/test', {
      method: 'POST',
      headers: { 'content-length': '2048' },
      body: '{}',
    });
    await expect(readBoundedJson(declared, 1_024)).rejects.toMatchObject({
      code: 'REQUEST_BODY_TOO_LARGE', status: 413,
    });

    const streamed = new Request('https://articles.example.com/api/test', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(2_000) }),
    });
    await expect(readBoundedJson(streamed, 1_024)).rejects.toMatchObject({
      code: 'REQUEST_BODY_TOO_LARGE', status: 413,
    });
  });

  it('returns a sanitized validation error for malformed JSON', async () => {
    const request = new Request('https://articles.example.com/api/test', {
      method: 'POST',
      body: '{invalid',
    });
    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: 'INVALID_JSON_BODY',
      message: 'The request body must be valid JSON.',
      status: 400,
    });
  });
});
