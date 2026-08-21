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
      <p className="text-sm text-neutral-500 mb-4">
        Who can do what. Each person holds <span className="font-semibold">one role</span> (what
        they do) plus optional <span className="font-semibold">need-to-know grants</span> — so one
        person can wear several hats without extra logins. Finer-grained roles are a board
        conversation if real duties call for them.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg bg-white border border-neutral-200 p-4">
          <p className="font-bold mb-1">Registrar</p>
          <p className="text-neutral-600">
            Registrations &amp; money for events: review and confirm sign-ups, edit families,
            record payments, rosters, check-in, tracked changes, exports.
          </p>
        </div>
        <div className="rounded-lg bg-white border border-neutral-200 p-4">
          <p className="font-bold mb-1">Coordinator</p>
          <p className="text-neutral-600">
            Day-of and program duties: check-in at the door, activities and buddy assignments
            (as those pages arrive). No access to family edits or money.
          </p>
        </div>
        <div className="rounded-lg bg-white border border-neutral-200 p-4">
          <p className="font-bold mb-1">Administrator</p>
          <p className="text-neutral-600">
            Everything — including this page: an administrator can add and remove staff,
            change anyone&rsquo;s role, and <span className="font-semibold">grant or revoke
            administrator itself</span>. All administrators are equal (there is no
            &ldquo;super admin&rdquo;), and nobody can demote, deactivate, or remove
            themselves — that always takes another administrator, which is one reason to
            have two. Also: event setup, accounts, two-factor resets, giving records.
            Keep this list short.
          </p>
        </div>
      </div>
      <div className="mb-6 rounded-lg bg-white border border-neutral-200 p-4 text-sm">
        <p className="font-bold mb-1">Separate grants (any role can hold them)</p>
        <p className="text-neutral-600">
          <span className="font-semibold">Sensitive</span> — medical, dietary, and support
          details (Dietary, Medical &amp; Support pages, red flags at check-in).{' '}
          <span className="font-semibold">Giving</span> — donor gift records (administrators have
          this automatically). Grants are need-to-know: give them only where duties require.
        </p>
      </div>

      <StaffManager members={members} selfId={staff.userId} />
    </div>
  );
}
