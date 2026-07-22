import { describe, expect, it } from 'vitest';

import { buildArticleCoverPrompt, inferBinanceMasterMode } from './article-cover';

describe('dedicated article cover prompt', () => {
  it('infers one Binance Master mode from article semantics', () => {
    expect(inferBinanceMasterMode({ title: 'Protocol metrics and market share comparison' }))
      .toBe('briefing');
    expect(inferBinanceMasterMode({ title: 'A beginner guide to your first wallet' }))
      .toBe('primer');
    expect(inferBinanceMasterMode({ title: 'How cross-chain settlement works' }))
      .toBe('mechanism');
    expect(inferBinanceMasterMode({ title: 'The modular Web3 ecosystem' }))
      .toBe('scene');
  });

  it('builds the locked no-text 2K source and 5:2 safe-frame contract', () => {
    const result = buildArticleCoverPrompt({
      title: 'How a bridge works',
      description: 'A sequenced cross-chain bridge explainer.',
      style: 'binance-master',
      slides: [{ title: 'Lock and mint', bullets: ['Verify the source chain'] }],
    });

    expect(result.styleMode).toBe('mechanism');
    expect(result.prompt).toMatch(/2\.35:1[\s\S]+2K/i);
    expect(result.prompt).toMatch(/centered 5:2 safe frame/i);
    expect(result.prompt).toMatch(/no embedded text of any kind/i);
    expect(result.prompt).toMatch(/MECHANISM mode/i);
    expect(result.prompt).toContain('<article_context>');
  });

  it('omits Master mode guidance for a fixed named style', () => {
    const result = buildArticleCoverPrompt({
      title: 'Crypto infrastructure',
      style: 'binance-briefing',
      styleMode: 'primer',
    });
    expect(result.styleMode).toBeNull();
    expect(result.prompt).not.toMatch(/Use PRIMER mode/);
  });
});
