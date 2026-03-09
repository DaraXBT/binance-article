import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getDeckWithAssets: vi.fn(),
};

const imageGenMock = {
  getBlobToken: vi.fn(() => 'blob-token'),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

const blobMock = {
  get: vi.fn(),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/image-gen', () => imageGenMock);
vi.mock('@/lib/workspace', () => workspaceMock);
vi.mock('@vercel/blob', () => blobMock);

function createBlobStream(bytes: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('GET /api/articles/[id]/assets/[filename]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the article is outside the current workspace', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue(null);

    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck-1', filename: 'slide-01.png' }) }
    );

    expect(response.status).toBe(404);
    expect(dbMock.getDeckWithAssets).toHaveBeenCalledWith('deck-1', 'workspace-1');
    expect(blobMock.get).not.toHaveBeenCalled();
  });

  it('returns image bytes inline with the blob content type for an authorized article asset', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck-1',
      slides: [
        {
          id: 'slide-1',
          imageUrl:
            'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
        },
      ],
    });
    blobMock.get.mockResolvedValue({
      statusCode: 200,
      stream: createBlobStream([1, 2, 3]),
      headers: new Headers(),
      blob: {
        url: 'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
        downloadUrl:
          'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png?download=1',
        pathname: 'decks/deck-1/slide-01.png',
        contentType: 'image/png',
        contentDisposition: 'inline; filename="slide-01.png"',
        cacheControl: 'public, max-age=3600',
        uploadedAt: new Date('2026-03-09T00:00:00.000Z'),
        size: 3,
        etag: 'etag-1',
      },
    });

    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck-1', filename: 'slide-01.png' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="slide-01.png"');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(blobMock.get).toHaveBeenCalledWith(
      'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png',
      expect.objectContaining({ access: 'private', token: 'blob-token' })
    );
  });

  it('sets attachment headers when download=1 is requested', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck-1',
      slides: [
        {
          id: 'slide-1',
          imageUrl:
            'https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide-01.jpeg',
        },
      ],
    });
    blobMock.get.mockResolvedValue({
      statusCode: 200,
      stream: createBlobStream([4, 5, 6]),
      headers: new Headers(),
      blob: {
        url: 'https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide-01.jpeg',
        downloadUrl:
          'https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide-01.jpeg?download=1',
        pathname: 'decks/deck-1/slide-01.jpeg',
        contentType: 'image/jpeg',
        contentDisposition: 'inline; filename="slide-01.jpeg"',
        cacheControl: 'public, max-age=3600',
        uploadedAt: new Date('2026-03-09T00:00:00.000Z'),
        size: 3,
        etag: 'etag-2',
      },
    });

    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1/assets/slide-01.jpeg?download=1') as never,
      { params: Promise.resolve({ id: 'deck-1', filename: 'slide-01.jpeg' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="slide-01.jpeg"');
    expect(blobMock.get).toHaveBeenCalledWith(
      'https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide-01.jpeg',
      expect.objectContaining({ access: 'public', token: 'blob-token' })
    );
  });

  it('returns 404 when the requested filename does not match any slide image', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck-1',
      slides: [
        {
          id: 'slide-1',
          imageUrl:
            'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-02.png',
        },
      ],
    });

    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck-1', filename: 'slide-01.png' }) }
    );

    expect(response.status).toBe(404);
    expect(blobMock.get).not.toHaveBeenCalled();
  });

  it('returns 404 when the filename is empty', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck-1',
      slides: [],
    });

    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1/assets/') as never,
      { params: Promise.resolve({ id: 'deck-1', filename: '' }) }
    );

    expect(response.status).toBe(404);
    expect(blobMock.get).not.toHaveBeenCalled();
  });
});
