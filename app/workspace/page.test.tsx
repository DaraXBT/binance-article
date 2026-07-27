import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActivePageUser: vi.fn(async () => ({
    name: 'Workspace Owner',
    email: 'owner@example.com',
  })),
}));

vi.mock('@/components/home/dashboard-home', () => ({
  DashboardHome: () => null,
}));

vi.mock('@/server/auth/page-authorization', () => ({
  requireActivePageUser: mocks.requireActivePageUser,
}));

describe('/workspace query state', () => {
  beforeEach(() => {
    mocks.requireActivePageUser.mockClear();
  });

  it('opens Connections and preserves a valid resume intent through authentication', async () => {
    const { default: WorkspacePage } = await import('./page');
    const resume = '7c67d7cf-47bd-4c5d-8dca-0980a9c27575';
    const result = await WorkspacePage({
      searchParams: Promise.resolve({ resume, settings: 'connections' }),
    }) as ReactElement<{
      settingsOpen: boolean;
      resumeIntentId: string;
    }>;

    expect(mocks.requireActivePageUser).toHaveBeenCalledWith(
      `/workspace?resume=${resume}&settings=connections`,
    );
    expect(result.props.settingsOpen).toBe(true);
    expect(result.props.resumeIntentId).toBe(resume);
  });

  it('ignores unknown settings values and links to the supported dialog', async () => {
    const { default: WorkspacePage } = await import('./page');
    const result = await WorkspacePage({
      searchParams: Promise.resolve({ settings: 'profile' }),
    }) as ReactElement<{ settingsOpen: boolean }>;

    expect(mocks.requireActivePageUser).toHaveBeenCalledWith('/workspace');
    expect(result.props.settingsOpen).toBe(false);
  });
});
