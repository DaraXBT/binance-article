import { describe, expect, it } from 'bun:test';

import { createPublisherAdapters } from '../src/main';

describe('publisher runtime V3 adapter wiring', () => {
  it('registers all four exact target-and-kind routes plus V1/V2 compatibility routes', () => {
    expect(Object.keys(createPublisherAdapters()).sort()).toEqual([
      'binance-square',
      'binance-square:article',
      'binance-square:post',
      'x',
      'x:article',
      'x:post',
    ]);
  });
});
