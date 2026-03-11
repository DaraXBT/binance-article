import { describe, expect, it } from 'vitest';

describe('POST /api/articles/[id]/render', () => {
  it('returns 501 because the production renderer is not implemented', async () => {
    const { POST } = await import('@/app/api/articles/[id]/render/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/render', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.code).toBe('RENDER_NOT_AVAILABLE');
  });
});
