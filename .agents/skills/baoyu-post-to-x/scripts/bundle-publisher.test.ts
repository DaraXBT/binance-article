import { describe, expect, mock, test } from 'bun:test';

import { prepareXPostBundle } from './bundle-publisher.js';

describe('prepareXPostBundle', () => {
  test('composes verified local content in preview mode and removes extracted files', async () => {
    const compose = mock(async () => undefined);
    const remove = mock(async () => undefined);
    const extract = mock(async () => ({
      bundleDir: '/tmp/x-post-bundle',
      text: 'Reviewed X post',
      imagePaths: ['/tmp/x-post-bundle/images/01-post.png'],
      manifest: { articleId: 'article-1' },
    }));

    const result = await prepareXPostBundle(
      { bundlePath: '/tmp/post.zip', profileDir: '/tmp/x-profile' },
      { compose, extract, remove },
    );

    expect(compose).toHaveBeenCalledWith({
      text: 'Reviewed X post',
      images: ['/tmp/x-post-bundle/images/01-post.png'],
      profileDir: '/tmp/x-profile',
      submit: false,
    });
    expect(remove).toHaveBeenCalledWith('/tmp/x-post-bundle');
    expect(result).toEqual({ composed: true, articleId: 'article-1', imageCount: 1 });
  });
});
