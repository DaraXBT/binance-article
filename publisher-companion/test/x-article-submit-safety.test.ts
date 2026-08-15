import { describe, expect, it, mock } from 'bun:test';

import {
  assertXArticlePublishMode,
  submitVerifiedXArticle,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

describe('standalone X Article submit safety', () => {
  it('rejects handing browser ownership off while also submitting internally', () => {
    expect(() => assertXArticlePublishMode({
      submit: true,
      onComposed: () => undefined,
    })).toThrow(/submit.*onComposed|onComposed.*submit/i);

    expect(() => assertXArticlePublishMode({ submit: true })).not.toThrow();
    expect(() => assertXArticlePublishMode({ onComposed: () => undefined })).not.toThrow();
  });

  it('revalidates after preview immediately before one scoped click', async () => {
    const order: string[] = [];
    const assertCurrent = mock(async () => { order.push('validate'); });
    const clickPublish = mock(async () => { order.push('click'); return true; });
    const waitForPublishedUrl = mock(async () => {
      order.push('evidence');
      return 'https://x.com/i/article/123456789';
    });

    await expect(submitVerifiedXArticle({
      assertCurrent,
      clickPublish,
      waitForPublishedUrl,
    })).resolves.toBe('https://x.com/i/article/123456789');

    expect(order).toEqual(['validate', 'click', 'evidence']);
    expect(assertCurrent).toHaveBeenCalledTimes(1);
    expect(clickPublish).toHaveBeenCalledTimes(1);
  });

  it('never clicks when the final post-preview evidence is stale', async () => {
    const clickPublish = mock(async () => true);

    await expect(submitVerifiedXArticle({
      assertCurrent: async () => { throw new Error('composition changed'); },
      clickPublish,
      waitForPublishedUrl: async () => 'https://x.com/i/article/123',
    })).rejects.toThrow(/composition changed/i);

    expect(clickPublish).not.toHaveBeenCalled();
  });

  it('fails closed when no scoped click or canonical publication evidence exists', async () => {
    const waitAfterMissedClick = mock(async () => 'https://x.com/i/article/123');
    await expect(submitVerifiedXArticle({
      assertCurrent: async () => undefined,
      clickPublish: async () => false,
      waitForPublishedUrl: waitAfterMissedClick,
    })).rejects.toThrow(/publish button|click/i);
    expect(waitAfterMissedClick).not.toHaveBeenCalled();

    await expect(submitVerifiedXArticle({
      assertCurrent: async () => undefined,
      clickPublish: async () => true,
      waitForPublishedUrl: async () => 'https://x.com/compose/articles',
    })).rejects.toThrow(/canonical.*article/i);

    await expect(submitVerifiedXArticle({
      assertCurrent: async () => undefined,
      clickPublish: async () => true,
      waitForPublishedUrl: async () => undefined,
    })).rejects.toThrow(/canonical.*article/i);
  });
});
