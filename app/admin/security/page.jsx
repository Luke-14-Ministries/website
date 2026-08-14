import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import AdminMfaReset from './AdminMfaReset';

export const metadata = { title: 'Two-Factor Resets — Staff Admin' };

// Admin-only. The /admin layout already requires staff + two-factor; this adds
// the admin check for this particular tool.
export default async function AdminSecurityPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/security/');
  if (!can(staff, 'admin')) redirect('/admin');

  return (
    <div>
      <AdminMfaReset />
    </div>
  );
}
