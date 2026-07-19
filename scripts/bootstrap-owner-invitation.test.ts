import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  assertBootstrapEnvironment,
  issueOwnerBootstrapInvitation,
  runOwnerBootstrapCli,
} from './bootstrap-owner-invitation.mjs';

const OPERATOR_URL =
  'postgresql://bootstrap_operator:password@ep-example.neon.tech/app?sslmode=require';
const FIXED_NOW = new Date('2026-07-20T00:00:00.000Z');
const FIXED_TOKEN = Buffer.alloc(32, 0xab).toString('base64url');

function deterministicRandomBytes(size: number) {
  expect(size).toBe(32);
  return Buffer.alloc(size, 0xab);
}

describe('first-owner bootstrap invitation', () => {
  it('requires an explicit TLS database, owner email, and HTTPS application origin', () => {
    expect(() => assertBootstrapEnvironment({})).toThrow('OPERATOR_DATABASE_URL');
    expect(() => assertBootstrapEnvironment({
      OPERATOR_DATABASE_URL: 'file:./dev.db',
      BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
      BETTER_AUTH_URL: 'https://articles.example.com',
    })).toThrow(/PostgreSQL/);
    expect(() => assertBootstrapEnvironment({
      OPERATOR_DATABASE_URL: OPERATOR_URL,
      BOOTSTRAP_OWNER_EMAIL: 'not-an-email',
      BETTER_AUTH_URL: 'https://articles.example.com',
    })).toThrow(/email/i);
    expect(() => assertBootstrapEnvironment({
      OPERATOR_DATABASE_URL: OPERATOR_URL,
      BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
      BETTER_AUTH_URL: 'http://articles.example.com',
    })).toThrow(/HTTPS/i);
  });

  it('atomically creates the only bootstrap invitation and persists only its hash', async () => {
    const query = vi.fn(async () => ([{
      result: 'created',
      id: 'bootstrap_invite-id',
      tokenPrefix: FIXED_TOKEN.slice(0, 8),
    }]));
    const createSql = vi.fn(() => query);

    await expect(issueOwnerBootstrapInvitation({
      environment: {
        OPERATOR_DATABASE_URL: OPERATOR_URL,
        BOOTSTRAP_OWNER_EMAIL: ' Owner@Example.com ',
        BETTER_AUTH_URL: 'https://articles.example.com',
      },
      createSql,
      randomBytes: deterministicRandomBytes,
      randomUuid: () => 'invite-id',
      now: () => FIXED_NOW,
    })).resolves.toEqual({
      invitationId: 'bootstrap_invite-id',
      joinUrl: `https://articles.example.com/join?token=${FIXED_TOKEN}`,
      expiresAt: new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(createSql).toHaveBeenCalledWith(OPERATOR_URL);
    const [strings, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('$value');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM "user"/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM "Invitation"/);
    expect(sql).toMatch(/INSERT INTO "Invitation"/);
    expect(sql).toMatch(/"createdByUserId"/);
    expect(values).toContain('bootstrap_invite-id');
    expect(values).toContain('owner@example.com');
    expect(values).toContain(createHash('sha256').update(FIXED_TOKEN).digest('hex'));
    expect(values).not.toContain(FIXED_TOKEN);
  });

  it('fails closed when bootstrap state is not empty or persistence fails', async () => {
    const notEmpty = vi.fn(async () => ([{ result: 'state_not_empty' }]));
    await expect(issueOwnerBootstrapInvitation({
      environment: {
        OPERATOR_DATABASE_URL: OPERATOR_URL,
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
        BETTER_AUTH_URL: 'https://articles.example.com',
      },
      createSql: () => notEmpty,
      randomBytes: deterministicRandomBytes,
    })).rejects.toThrow('already initialized');

    const failed = vi.fn(async () => {
      throw new Error(`password=database-secret token=${FIXED_TOKEN}`);
    });
    await expect(issueOwnerBootstrapInvitation({
      environment: {
        OPERATOR_DATABASE_URL: OPERATOR_URL,
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
        BETTER_AUTH_URL: 'https://articles.example.com',
      },
      createSql: () => failed,
      randomBytes: deterministicRandomBytes,
    })).rejects.toThrow('could not be created');
  });

  it('prints the one-time join URL only after creation succeeds', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const issue = vi.fn(async () => ({
      invitationId: 'bootstrap_invite-id',
      joinUrl: `https://articles.example.com/join?token=${FIXED_TOKEN}`,
      expiresAt: FIXED_NOW,
    }));

    await expect(runOwnerBootstrapCli({ issue, log, error })).resolves.toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(FIXED_TOKEN);
    expect(error).not.toHaveBeenCalled();

    issue.mockRejectedValueOnce(new Error(`database-secret ${FIXED_TOKEN}`));
    log.mockClear();
    await expect(runOwnerBootstrapCli({ issue, log, error })).resolves.toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).not.toContain(FIXED_TOKEN);
    expect(error.mock.calls.flat().join('\n')).not.toContain('database-secret');
  });
});
