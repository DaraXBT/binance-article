import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getDeckProject: vi.fn(),
  createSlidesFromGeneration: vi.fn(),
  updateDeckProject: vi.fn(),
};

const geminiMock = {
  generateDeckWithGemini: vi.fn(),
  normalizeGeminiError: vi.fn(),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/gemini', () => geminiMock);
vi.mock('@/lib/workspace', () => workspaceMock);

describe('POST /api/articles/[id]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getDeckProject.mockResolvedValue({
      id: 'deck-1',
    });
  });

  it('returns a normalized 429 when Gemini quota is exhausted', async () => {
    const providerError = new Error('provider quota error');
    geminiMock.generateDeckWithGemini.mockRejectedValue(providerError);
    geminiMock.normalizeGeminiError.mockReturnValue({
      statusCode: 429,
      message: 'Gemini API quota exceeded for gemini-2.0-flash. Retry in about 41 seconds.',
      providerCode: 429,
      retryAfterSeconds: 41,
      model: 'gemini-2.0-flash',
    });

    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: 'Gemini API quota exceeded for gemini-2.0-flash. Retry in about 41 seconds.',
      code: 429,
      retryAfterSeconds: 41,
      model: 'gemini-2.0-flash',
    });
    expect(dbMock.createSlidesFromGeneration).not.toHaveBeenCalled();
    expect(dbMock.updateDeckProject).not.toHaveBeenCalled();
  });
});
