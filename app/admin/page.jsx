import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Overview — Staff Admin' };

const STATUSES = ['submitted', 'waitlisted', 'confirmed', 'draft', 'cancelled'];

export default async function AdminOverview() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/');

  const supabase = await createClient();

  // As staff, row-level security returns the whole ministry, not one household.
  const [{ data: regs }, { data: parts }] = await Promise.all([
    supabase.from('registrations').select('id, households ( display_name ), events ( name )'),
    supabase
      .from('registration_participants')
      .select('status, registration_id, people ( first_name, last_name )'),
  ]);

  const registrations = regs ?? [];
  const participants = parts ?? [];

  const regById = new Map();
  for (const r of registrations) {
    regById.set(r.id, {
      household: r.households?.display_name ?? 'Household',
      event: r.events?.name ?? 'Unassigned',
    });
  }

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byEvent = new Map();
  // Registrations that have at least one participant awaiting review.
  const needsReview = new Map();
  for (const p of participants) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const meta = regById.get(p.registration_id);
    const ev = meta?.event ?? 'Unassigned';
    byEvent.set(ev, (byEvent.get(ev) ?? 0) + 1);
    if (p.status === 'submitted') {
      const cur = needsReview.get(p.registration_id) ?? {
        household: meta?.household ?? 'Household',
        event: ev,
        count: 0,
      };
      cur.count += 1;
      needsReview.set(p.registration_id, cur);
    }
  }

  const reviewList = [...needsReview.entries()];

  const Stat = ({ label, value }) => (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Overview</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Stat label="Registrations" value={registrations.length} />
        <Stat label="People registered" value={participants.length} />
        <Stat label="Confirmed" value={byStatus.confirmed} />
        <Stat label="New registrations awaiting review" value={byStatus.submitted + byStatus.waitlisted} />
      </div>

      {/* The work queue: families with someone still pending review. */}
      {can(staff, 'registrar') && reviewList.length > 0 && (
        <div className="rounded-lg bg-white border border-amber-200 shadow-sm p-6 mb-8">
          <h3 className="font-bold mb-1">New registrations awaiting review</h3>
          <p className="text-sm text-neutral-500 mb-3">
            Families with someone marked &ldquo;submitted — pending review&rdquo; — new sign-ups,
            newly added people, or a changed role. Open one to confirm, waitlist, or edit.
            (Edits to existing info live on the Recent Changes page instead.)
          </p>
          <ul className="divide-y divide-neutral-100">
            {reviewList.map(([id, r]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/admin/registrations/${id}`} className="text-brand underline font-medium">
                    {r.household}
                  </Link>
                  <span className="text-neutral-500"> — {r.event}</span>
                </span>
                <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
                  {r.count} pending
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">By status</h3>
          <ul className="space-y-1 text-neutral-700">
            {STATUSES.map((s) => (
              <li key={s} className="flex justify-between">
                <span className="capitalize">{s}</span>
                <span className="font-semibold">{byStatus[s]}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">By camp week</h3>
          {byEvent.size === 0 ? (
            <p className="text-neutral-500">No registrations yet.</p>
          ) : (
            <ul className="space-y-1 text-neutral-700">
              {[...byEvent.entries()].map(([ev, n]) => (
                <li key={ev} className="flex justify-between">
                  <span>{ev}</span>
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/rosters" className="btn-outline !py-2 mt-4 inline-block">
            View full rosters
          </Link>
        </div>
      </div>
    </div>
  );
}
