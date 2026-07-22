import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1' })),
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  repository: { repository: true },
  createRepository: vi.fn(),
  approve: vi.fn(async () => ({ id: 'command_1', target: 'x', state: 'approved' })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createRepository.mockReturnValue(mocks.repository);

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/approvals/repository', () => ({
  createWebPublishApprovalRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publisher/approvals/service', () => ({ approveWebPublication: mocks.approve }));

describe('POST /api/publisher/commands/:id/approve', () => {
  it('requires authenticated explicit revision and recipe-hash confirmation', async () => {
    const { POST } = await import('./route');
    const body = { revision: 2, recipeHash: 'a'.repeat(64), confirmed: true };
    const request = new Request('https://articles.example.com/api/publisher/commands/command_1/approve', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await POST(request as never, { params: Promise.resolve({ id: 'command_1' }) });
    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.approve).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1', commandId: 'command_1',
      revision: 2, recipeHash: 'a'.repeat(64), confirmed: true,
    });
    expect(await response.json()).toEqual({ command: { id: 'command_1', target: 'x', state: 'approved' } });
  });
});
