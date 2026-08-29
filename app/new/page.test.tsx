import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((destination: string) => {
  throw new Error(`redirect:${destination}`);
}));

vi.mock('next/navigation', () => ({ redirect }));

import NewArticlePage from './page';

describe('legacy new-article route', () => {
  it.each([
    [{}, '/workspace'],
    [{ mode: 'prompt' }, '/workspace'],
    [{ mode: 'text' }, '/workspace?source=text'],
    [{ mode: 'url' }, '/workspace?source=url'],
    [{ mode: 'unknown' }, '/workspace'],
  ])('redirects %o to %s', async (searchParams, destination) => {
    await expect(NewArticlePage({ searchParams: Promise.resolve(searchParams) }))
      .rejects.toThrow(`redirect:${destination}`);
    expect(redirect).toHaveBeenLastCalledWith(destination);
  });
});
