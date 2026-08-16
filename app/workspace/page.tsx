import { DashboardHome } from '@/components/home/dashboard-home';
import { requireActivePageUser } from '@/server/auth/page-authorization';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkspaceSearchParams = Record<string, string | string[] | undefined>;

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<WorkspaceSearchParams>;
}) {
  const params = await searchParams;
  const resumeRequested = params.resume !== undefined;
  const resumeIntentId = typeof params.resume === 'string' && UUID_PATTERN.test(params.resume)
    ? params.resume
    : null;
  const settingsOpen = params.settings === 'connections';
  const callbackParams = new URLSearchParams();
  if (resumeIntentId) callbackParams.set('resume', resumeIntentId);
  if (settingsOpen) callbackParams.set('settings', 'connections');
  const callbackQuery = callbackParams.toString();
  const callback = callbackQuery ? `/workspace?${callbackQuery}` : '/workspace';
  const actor = await requireActivePageUser(callback);
  return (
    <DashboardHome
      resumeIntentId={resumeIntentId}
      resumeRequested={resumeRequested}
      settingsOpen={settingsOpen}
      canManageAccess={actor.role === 'owner'}
      actor={{ name: actor.name, email: actor.email }}
    />
  );
}
