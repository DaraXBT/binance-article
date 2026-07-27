import { redirect } from 'next/navigation';

export default function ConnectionsPage() {
  redirect('/workspace?settings=connections');
}
