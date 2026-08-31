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
      'profile_id, role, title, can_view_sensitive, can_view_giving, can_view_background_checks, active, profiles ( first_name, last_name )'
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
    backgroundChecks: r.can_view_background_checks === true,
    active: r.active === true,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold mb-1">Staff &amp; Access</h2>
        {/* The log is only worth keeping if somebody can read it. */}
        <a href="/admin/staff/access-log" className="btn-outline !py-2 shrink-0">
          Access changes
        </a>
      </div>
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
            have two. Also: event setup, accounts, and two-factor resets. Sensitive and
            Giving are separate grants even for administrators — self-grantable, but
            deliberately not automatic. Keep this list short.
          </p>
        </div>
      </div>
      <div className="mb-6 rounded-lg bg-white border border-neutral-200 p-4 text-sm">
        <p className="font-bold mb-1">Separate grants (any role can hold them)</p>
        <p className="text-neutral-600">
          <span className="font-semibold">Sensitive</span> — medical, dietary, and support
          details (Dietary, Medical &amp; Support pages, red flags at check-in).{' '}
          <span className="font-semibold">Giving</span> — donor gift records.{' '}
          {/* "Checks" had a column in the table and no explanation anywhere, so
              the only way to learn what it did was to tick it and find out
              (asked 31 Aug). */}
          <span className="font-semibold">Checks</span> — volunteer background
          checks: whether somebody has been screened, when, and what came back.
          Its own grant for the same reason Giving is — whether a person was
          screened is a different kind of knowledge from their medical needs, and
          the people who need each are not the same set. Grants are
          need-to-know: give them only where duties require.
        </p>
        {/* Why NEITHER grant is automatic, even for administrators (decided
            21 Aug 2026; migration 0025 removed the old admin auto-grant on
            giving). The checkboxes are not barriers against the person -- an
            admin self-grants in one click -- they are protection for the
            room: the difference between "can't see" and "doesn't see". */}
        <p className="text-neutral-600 mt-2">
          <span className="font-semibold">Why neither grant is automatic, even for
          administrators:</span> nothing about running the platform requires seeing medical
          details or donor giving, and an administrator with a grant <em>off</em> has safe
          screens to project at check-in or share in a meeting — and keeps the list of
          people who can see that information short and nameable. Any administrator can
          grant either to themselves in one click when a task truly needs it; the point is
          that seeing this data is a deliberate choice, not something that comes along
          with other duties.
        </p>
      </div>

      <StaffManager members={members} selfId={staff.userId} />
    </div>
  );
}
