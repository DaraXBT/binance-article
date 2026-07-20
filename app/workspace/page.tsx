import { DashboardHome } from '@/components/home/dashboard-home';
import { requireActivePageUser } from '@/server/auth/page-authorization';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string | string[] }>;
}) {
  const params = await searchParams;
  const resumeRequested = params.resume !== undefined;
  const resumeIntentId = typeof params.resume === 'string' && UUID_PATTERN.test(params.resume)
    ? params.resume
    : null;
  const callback = resumeIntentId
    ? `/workspace?resume=${encodeURIComponent(resumeIntentId)}`
    : '/workspace';
  const actor = await requireActivePageUser(callback);
  return (
    <DashboardHome
      resumeIntentId={resumeIntentId}
      resumeRequested={resumeRequested}
      actor={{ name: actor.name, email: actor.email }}
    />
  );
}
