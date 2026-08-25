import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Overview — Staff Admin' };

// The Overview reads in plain language: how many FAMILIES have signed up, how
// many PEOPLE are coming, and what needs staff attention. One per-event table
// carries the detail; nothing is shown twice. (A "registration" is one
// family's sign-up for one event — the labels here avoid assuming staff know
// that vocabulary.)
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

  // Per-event rollup: families, people coming (not cancelled/draft),
  // confirmed, pending review. Cancelled/draft are counted once for the
  // footnote, not mixed into the headline numbers.
  const byEvent = new Map();
  const eventRow = (ev) => {
    if (!byEvent.has(ev)) {
      byEvent.set(ev, {
        families: new Set(),
        people: 0,
        confirmed: 0,
        pending: 0,
        waitlisted: 0,
      });
    }
    return byEvent.get(ev);
  };
  let cancelled = 0;
  let draft = 0;
  const needsReview = new Map();

  for (const p of participants) {
    const meta = regById.get(p.registration_id);
    const ev = meta?.event ?? 'Unassigned';
    if (p.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    if (p.status === 'draft') {
      draft += 1;
      continue;
    }
    const row = eventRow(ev);
    row.families.add(p.registration_id);
    row.people += 1;
    if (p.status === 'confirmed') row.confirmed += 1;
    // Waitlisted is a decision staff have ALREADY made, not work outstanding.
    // Counting it as "awaiting review" (as this did until 25 Aug) put a
    // number on the page that no amount of reviewing could ever clear, and
    // made the headline disagree with the list underneath it, which only ever
    // showed 'submitted'. Same rule as the nav badges: an amber number has to
    // be reachable by doing the work.
    if (p.status === 'submitted') row.pending += 1;
    if (p.status === 'waitlisted') row.waitlisted += 1;

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

  const totalFamilies = new Set(
    participants
      .filter((p) => p.status !== 'cancelled' && p.status !== 'draft')
      .map((p) => p.registration_id)
  ).size;
  const totalPeople = [...byEvent.values()].reduce((s, r) => s + r.people, 0);
  const totalConfirmed = [...byEvent.values()].reduce((s, r) => s + r.confirmed, 0);
  const totalPending = [...byEvent.values()].reduce((s, r) => s + r.pending, 0);
  const totalWaitlisted = [...byEvent.values()].reduce((s, r) => s + r.waitlisted, 0);

  const reviewList = [...needsReview.entries()];

  const Stat = ({ label, sub, value, tone }) => (
    <div
      className={`rounded-lg bg-white border shadow-sm p-5 ${
        tone === 'amber' ? 'border-amber-300' : 'border-neutral-200'
      }`}
    >
      <div className={`text-3xl font-bold ${tone === 'amber' ? 'text-amber-700' : ''}`}>
        {value}
      </div>
      <div className="text-sm font-semibold text-neutral-700">{label}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Stat
          label="Families signed up"
          sub="each family registers once per event"
          value={totalFamilies}
        />
        <Stat
          label="People coming"
          sub={`across those families · ${totalConfirmed} confirmed`}
          value={totalPeople}
        />
        <Stat
          label="Awaiting review"
          sub={
            totalPending > 0
              ? 'needs staff action below'
              : totalWaitlisted > 0
                ? `nothing waiting on staff · ${totalWaitlisted} waitlisted`
                : 'nothing waiting on staff'
          }
          value={totalPending}
          tone={totalPending > 0 ? 'amber' : undefined}
        />
      </div>

      {/* The work queue: families with someone still pending review.
          Given an id (25 Aug) because other pages point at it in words --
          Recent Changes says new people "land in the Awaiting review queue on
          the Overview" -- and a page you have to hunt for is not really a
          queue. That sentence is now a link to this card. */}
      {can(staff, 'registrar') && reviewList.length > 0 && (
        <div
          id="awaiting-review"
          className="scroll-mt-4 rounded-lg bg-white border border-amber-200 shadow-sm p-6 mb-8"
        >
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

      <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="font-bold">By event</h3>
          <Link href="/admin/rosters" className="btn-outline !py-1.5 text-sm">
            View full rosters
          </Link>
        </div>
        {byEvent.size === 0 ? (
          <p className="text-neutral-500">No sign-ups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Event</th>
                  <th className="py-2 pr-4 font-semibold text-right">Families</th>
                  <th className="py-2 pr-4 font-semibold text-right">People</th>
                  <th className="py-2 pr-4 font-semibold text-right">Confirmed</th>
                  <th className="py-2 pr-4 font-semibold text-right">Waitlisted</th>
                  <th className="py-2 font-semibold text-right">Awaiting review</th>
                </tr>
              </thead>
              <tbody>
                {[...byEvent.entries()].map(([ev, r]) => (
                  <tr key={ev} className="border-t border-neutral-100">
                    <td className="py-2 pr-4 font-medium">{ev}</td>
                    <td className="py-2 pr-4 text-right">{r.families.size}</td>
                    <td className="py-2 pr-4 text-right">{r.people}</td>
                    <td className="py-2 pr-4 text-right text-green-700 font-semibold">{r.confirmed}</td>
                    <td className="py-2 pr-4 text-right text-neutral-600">{r.waitlisted}</td>
                    <td className={`py-2 text-right font-semibold ${r.pending > 0 ? 'text-amber-700' : 'text-neutral-400'}`}>
                      {r.pending}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(cancelled > 0 || draft > 0) && (
          <p className="mt-3 text-xs text-neutral-400">
            Not counted above:
            {cancelled > 0 ? ` ${cancelled} cancelled` : ''}
            {cancelled > 0 && draft > 0 ? ' ·' : ''}
            {draft > 0 ? ` ${draft} unfinished (draft)` : ''}
            .
          </p>
        )}
      </div>
    </div>
  );
}
