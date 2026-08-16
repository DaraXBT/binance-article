import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from '@/proxy';
import { evaluateCutoverMaintenance } from './cutover-maintenance';

describe('cutover maintenance policy', () => {
  it.each([undefined, '', 'off'])('stays disabled for mode %s', (mode) => {
    expect(evaluateCutoverMaintenance({ mode })).toEqual({ blocked: false });
  });

  it('fails closed when full maintenance has no operator allowlist', () => {
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      connectingIp: '203.0.113.8',
    })).toEqual({ blocked: true });
  });

  it('allows only an exact operator IP during full maintenance', () => {
    const allowedIps = ' 203.0.113.8,2001:db8::7 ';

    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps,
      connectingIp: '203.0.113.8',
    })).toEqual({ blocked: false });
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps,
      connectingIp: '2001:db8::7',
    })).toEqual({ blocked: false });
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps,
      connectingIp: '203.0.113.80',
    })).toEqual({ blocked: true });
  });

  it.each([
    undefined,
    'not-an-ip',
    `${'1'.repeat(1_025)}`,
    Array.from({ length: 17 }, (_, index) => `192.0.2.${index + 1}`).join(','),
  ])('blocks missing or malformed allowlist input %#', (allowedIps) => {
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps,
      connectingIp: '192.0.2.1',
    })).toEqual({ blocked: true });
  });

  it.each([undefined, '', 'unknown-client'])('blocks an untrusted client IP %s', (connectingIp) => {
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps: '203.0.113.8',
      connectingIp,
    })).toEqual({ blocked: true });
  });

  it.each(['FULL', 'publications', 'unexpected'])('fails closed for noncanonical mode %s', (mode) => {
    expect(evaluateCutoverMaintenance({
      mode,
      allowedIps: '203.0.113.8',
      connectingIp: '203.0.113.8',
    })).toEqual({ blocked: true });
  });
});

describe('cutover maintenance proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a no-store 503 JSON response for blocked API traffic', async () => {
    vi.stubEnv('CUTOVER_MAINTENANCE_MODE', 'full');
    vi.stubEnv('CUTOVER_MAINTENANCE_ALLOW_IPS', '203.0.113.8');
    const request = new NextRequest('https://binance.v27.tech/api/workspace/ai-credential', {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'cf-connecting-ip': '198.51.100.4',
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('120');
    await expect(response.json()).resolves.toEqual({
      error: 'Scheduled maintenance is in progress. Please try again shortly.',
    });
  });

  it('lets an exact allowlisted operator continue to the application', async () => {
    vi.stubEnv('CUTOVER_MAINTENANCE_MODE', 'full');
    vi.stubEnv('CUTOVER_MAINTENANCE_ALLOW_IPS', '203.0.113.8');
    const request = new NextRequest('https://binance.v27.tech/settings/connections', {
      headers: { 'cf-connecting-ip': '203.0.113.8' },
    });

    const response = await proxy(request);

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('returns a responsive no-store maintenance page for blocked browser traffic', async () => {
    vi.stubEnv('CUTOVER_MAINTENANCE_MODE', 'full');
    const request = new NextRequest('https://binance.v27.tech/settings/connections', {
      headers: {
        accept: 'text/html',
        'cf-connecting-ip': '198.51.100.4',
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    await expect(response.text()).resolves.toContain('We\u2019ll be right back');
  });
});
