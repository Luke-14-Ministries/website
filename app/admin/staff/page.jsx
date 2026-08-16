import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import StaffManager from './StaffManager';

export const metadata = { title: 'Staff & Access — Staff Admin' };

// Who is on staff, wearing which hat, holding which grants. Admin-only; the
// staff_write RLS policy is the real gate. One login, many hats: roles say what
// a person DOES, while sensitive/giving are separate need-to-know grants.
export default async function StaffAccessPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/staff/');
  if (!can(staff, 'admin')) redirect('/admin');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('staff')
    .select(
      'profile_id, role, title, can_view_sensitive, can_view_giving, active, profiles ( first_name, last_name )'
    )
    .order('active', { ascending: false })
    .order('role');

  const members = (rows ?? []).map((r) => ({
    profileId: r.profile_id,
    name:
      [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' ').trim() ||
      '(no name on profile)',
    role: r.role,
    title: r.title ?? '',
    sensitive: r.can_view_sensitive === true,
    giving: r.can_view_giving === true,
    active: r.active === true,
  }));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Staff &amp; Access</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Who can do what. A <span className="font-semibold">role</span> says what someone does
        (Registrar — registrations &amp; payments; Coordinator — activities, buddies, and door
        duty; Administrator — everything). <span className="font-semibold">Sensitive</span> and{' '}
        <span className="font-semibold">Giving</span> are separate need-to-know grants — they are
        not implied by role, so give them only to people whose duties require them.
      </p>

      <StaffManager members={members} selfId={staff.userId} />
    </div>
  );
}
