import { describe, expect, it } from 'bun:test';

import { parseCompanionArguments } from '../src/cli';

describe('publisher companion CLI', () => {
  it('never accepts pairing codes or device tokens through argv', () => {
    expect(() => parseCompanionArguments(['pair', '--pairing-code', 'secret'])).toThrow(/stdin/i);
    expect(() => parseCompanionArguments(['run', '--device-token', 'secret'])).toThrow(/stdin|keyring/i);
  });

  it('accepts a pairing origin and run-once control without secret arguments', () => {
    expect(parseCompanionArguments(['pair', '--api', 'https://articles.example.com']))
      .toEqual({ command: 'pair', baseUrl: 'https://articles.example.com' });
    expect(parseCompanionArguments(['run', '--once'])).toEqual({ command: 'run', once: true });
  });
});
