import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'Access changes — Staff Admin' };

// Who gained what, when, and who gave it to them.
//
// Until migration 0058 there was no record of this at all: somebody could grant
// themselves sight of medical detail, giving history or background checks and
// nothing anywhere would show it. The log closed that. This page is the half
// that makes it useful -- a log nobody can read is only a promise.
//
// Admin-only, and RLS says so too (staff_access_log_admin_read). The redirect
// here is courtesy; the policy is the actual boundary.

const FIELD_LABEL = {
  role: 'Role',
  can_view_sensitive: 'Sensitive access',
  can_view_giving: 'Giving access',
  can_view_background_checks: 'Background checks',
  active: 'Account active',
};

// A boolean flag reads as granted/removed, because that is what it means to a
// person. A role reads as itself. Showing "false → true" would be accurate and
// useless.
function describe(field, from, to) {
  if (field === 'role') return `${from ?? '—'} → ${to ?? '—'}`;
  if (to === 'true') return from === undefined || from === null ? 'granted' : 'granted';
  if (to === 'false') return 'removed';
  return `${from ?? '—'} → ${to ?? '—'}`;
}

const name = (p) =>
  p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed' : null;

export default async function AccessLogPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/staff/access-log/');
  if (!can(staff, 'admin')) redirect('/admin');

  const supabase = await createClient();

  // TWO foreign keys from this table to profiles -- the person changed, and the
  // person who changed them. PostgREST cannot guess which, so both embeds are
  // hinted by constraint name. An unhinted embed fails, and the error is easy
  // to discard into a silent empty page, which is exactly how this table would
  // come to look reassuringly empty.
  const { data: rows, error } = await supabase
    .from('staff_access_log')
    .select(
      `id, field, old_value, new_value, changed_at, changed_by_self,
       subject:profiles!staff_access_log_staff_profile_id_fkey ( first_name, last_name ),
       actor:profiles!staff_access_log_changed_by_fkey ( first_name, last_name )`
    )
    .order('changed_at', { ascending: false })
    .limit(200);

  const selfGrants = (rows ?? []).filter(
    (r) => r.changed_by_self && r.new_value === 'true'
  ).length;

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-6">
      <BackLink href="/admin/staff" label="Back to Staff &amp; Access" />
      <h1 className="text-2xl font-bold mb-1">Access changes</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Every change to what a staff member may see or do — role, the three
        sensitive permissions, and whether their account is active. Written
        automatically and cannot be edited or deleted by anyone, including an
        administrator. Most recent 200.
      </p>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          The log could not be read: {error.message}. This is a failure to load, not
          an empty log — do not read it as “nothing has changed”.
        </p>
      )}

      {!error && selfGrants > 0 && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{selfGrants}</strong>{' '}
          {selfGrants === 1 ? 'permission was' : 'permissions were'} granted by
          somebody to their own account. That is allowed — an administrator has to
          be able to — and it is shown here because it is the change most worth
          being able to find.
        </p>
      )}

      {!error && (rows ?? []).length === 0 ? (
        <p className="text-neutral-600">
          Nothing recorded yet. Logging began on 26 August 2026; anything before that
          date happened before there was a log to write it in.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Who</th>
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">Change</th>
                <th className="px-3 py-2 font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(rows ?? []).map((r) => {
                const granted = r.new_value === 'true';
                return (
                  <tr key={r.id} className={r.changed_by_self ? 'bg-amber-50/60' : ''}>
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                      {r.changed_at?.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-semibold">{name(r.subject) ?? '—'}</td>
                    <td className="px-3 py-2">{FIELD_LABEL[r.field] ?? r.field}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          granted
                            ? 'font-semibold text-green-800'
                            : r.new_value === 'false'
                              ? 'text-neutral-600'
                              : ''
                        }
                      >
                        {describe(r.field, r.old_value, r.new_value)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {name(r.actor) ?? (
                        <span className="italic text-neutral-500">
                          system or migration
                        </span>
                      )}
                      {r.changed_by_self && (
                        <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          own account
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
