import { describe, expect, it } from 'vitest';

import {
  createCutoverMaintenanceResponse,
  evaluateCutoverMaintenance,
} from './cutover-maintenance';

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
    '192.0.2.1,not-an-ip',
    '192.0.2.1,',
    '192.0.2.1,999.999.999.999',
    '192.0.2.1,2001:::7',
    `${'1'.repeat(1_025)}`,
    Array.from({ length: 17 }, (_, index) => `192.0.2.${index + 1}`).join(','),
  ])('blocks missing or malformed allowlist input %#', (allowedIps) => {
    expect(evaluateCutoverMaintenance({
      mode: 'full',
      allowedIps,
      connectingIp: '192.0.2.1',
    })).toEqual({ blocked: true });
  });

  it.each([
    undefined,
    '',
    'unknown-client',
    '999.999.999.999',
    '2001:::7',
  ])('blocks an untrusted client IP %s', (connectingIp) => {
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

describe('cutover maintenance Worker response', () => {
  it('returns a no-store 503 JSON response for blocked API traffic', async () => {
    const request = new Request('https://binance.v27.tech/api/workspace/ai-credential', {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'cf-connecting-ip': '198.51.100.4',
      },
    });

    const response = createCutoverMaintenanceResponse({
      request,
      environment: {
        CUTOVER_MAINTENANCE_MODE: 'full',
        CUTOVER_MAINTENANCE_ALLOW_IPS: '203.0.113.8',
      },
    });

    expect(response).not.toBeNull();
    if (!response) throw new Error('Expected a maintenance response.');
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('retry-after')).toBe('120');
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    await expect(response.json()).resolves.toEqual({
      error: 'Scheduled maintenance is in progress. Please try again shortly.',
    });
  });

  it('lets an exact allowlisted operator continue to the application', () => {
    const request = new Request('https://binance.v27.tech/settings/connections', {
      headers: { 'cf-connecting-ip': '203.0.113.8' },
    });

    const response = createCutoverMaintenanceResponse({
      request,
      environment: {
        CUTOVER_MAINTENANCE_MODE: 'full',
        CUTOVER_MAINTENANCE_ALLOW_IPS: '203.0.113.8',
      },
    });

    expect(response).toBeNull();
  });

  it('returns a responsive no-store maintenance page for blocked browser traffic', async () => {
    const request = new Request('https://binance.v27.tech/settings/connections', {
      headers: {
        accept: 'text/html',
        'cf-connecting-ip': '198.51.100.4',
      },
    });

    const response = createCutoverMaintenanceResponse({
      request,
      environment: { CUTOVER_MAINTENANCE_MODE: 'full' },
    });

    expect(response).not.toBeNull();
    if (!response) throw new Error('Expected a maintenance response.');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('retry-after')).toBe('120');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    await expect(response.text()).resolves.toContain('We\u2019ll be right back');
  });
});
