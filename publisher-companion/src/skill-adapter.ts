type SkillModule = {
  prepareBundle(input: { bundlePath: string }): Promise<
    | { valid: true }
    | { id: string }
  >;
  publishPreparedDraft(
    draftId: string,
    input: { beforeClick: () => Promise<void> },
  ): Promise<{ verified: true; reason: string; publishedUrl?: string }>;
};

async function loadSkill(): Promise<SkillModule> {
  const modulePath = '../../.agents/skills/baoyu-post-to-binance-square/scripts/bundle-publisher.ts';
  return await import(modulePath) as SkillModule;
}

export function classifySkillPublishResult(input: {
  verified: true;
  reason: string;
  publishedUrl?: string;
}):
  | { outcome: 'succeeded'; publishedUrl: string }
  | { outcome: 'outcome_unknown'; failureReason: 'OUTCOME_UNVERIFIED' } {
  if (input.publishedUrl) {
    try {
      const url = new URL(input.publishedUrl);
      if (
        url.protocol === 'https:'
        && (url.hostname === 'binance.com' || url.hostname.endsWith('.binance.com'))
        && /\/square\/(?:post|article)\/[^/]+/i.test(url.pathname)
        && !url.username
        && !url.password
      ) {
        return { outcome: 'succeeded', publishedUrl: url.toString() };
      }
    } catch {
      // A noncanonical URL is always ambiguous.
    }
  }
  return { outcome: 'outcome_unknown', failureReason: 'OUTCOME_UNVERIFIED' };
}

export class BaoyuBinanceSkillAdapter {
  async prepare(bundlePath: string): Promise<{ draftId: string }> {
    const { prepareBundle } = await loadSkill();
    const prepared = await prepareBundle({ bundlePath });
    if ('valid' in prepared) throw new Error('The Binance skill returned a dry-run result.');
    return { draftId: prepared.id };
  }

  async publish(
    draftId: string,
    options: { beforeClick: () => Promise<void> },
  ) {
    const { publishPreparedDraft } = await loadSkill();
    return publishPreparedDraft(draftId, { beforeClick: options.beforeClick });
  }
}
