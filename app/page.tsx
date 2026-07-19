import { DashboardHome } from '@/components/home/dashboard-home';
import { requireActivePageUser } from '@/server/auth/page-authorization';

export default async function DashboardPage() {
  await requireActivePageUser('/');
  return <DashboardHome />;
}
