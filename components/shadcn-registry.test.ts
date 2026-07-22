import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shadcn registry configuration', () => {
  it('registers the Efferd namespace used by the auth block', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'components.json'), 'utf8'),
    ) as { registries?: Record<string, string> };

    expect(config.registries?.['@efferd']).toBe(
      'https://efferd.com/r/{style}/{name}.json',
    );
  });
});
