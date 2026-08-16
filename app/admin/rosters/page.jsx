import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RosterTable from './RosterTable';

export const metadata = { title: 'Rosters — Staff Admin' };

export default async function RostersPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/rosters/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: events }, { data: regs }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id, created_at,
         households ( display_name, email, phone ),
         registration_participants ( camp_role, status, fee_cents, submitted_at, created_at,
           people ( first_name, last_name ) )`
      )
      .order('created_at'),
  ]);

  const eventsList = events ?? [];
  // Flatten to sortable rows per event.
  const rowsByEvent = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (!rowsByEvent.has(r.event_id)) rowsByEvent.set(r.event_id, []);
      rowsByEvent.get(r.event_id).push({
        registrationId: r.id,
        household: r.households?.display_name ?? 'Household',
        contact: [r.households?.email, r.households?.phone].filter(Boolean).join(' · '),
        person: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
        role: p.camp_role,
        status: p.status,
        fee: p.fee_cents ?? 0,
        submitted: p.submitted_at ?? p.created_at ?? '',
      });
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Rosters</h2>
        <div className="flex gap-3 text-sm">
          <a href="/admin/exports/rosters" className="btn-outline !py-1.5">
            Download CSV
          </a>
          <Link href="/admin/rosters/print" className="btn-outline !py-1.5">
            Print view
          </Link>
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Everyone registered, by camp week — click a column heading to sort (newest submissions
        first by default). Select a household to review it, change a status, or add and edit
        people. Medical and dietary detail lives on its own permission.
      </p>

      {eventsList.length === 0 && <p className="text-neutral-500">No camp weeks published yet.</p>}

      {eventsList.map((ev) => {
        const rows = rowsByEvent.get(ev.id) ?? [];
        const families = new Set(rows.map((r) => r.registrationId)).size;
        return (
          <div key={ev.id} className="mb-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-bold">{ev.name}</h3>
              <span className="text-sm text-neutral-500">
                {families} {families === 1 ? 'family' : 'families'} · {rows.length}{' '}
                {rows.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="text-neutral-500 text-sm">No registrations yet.</p>
            ) : (
              <RosterTable rows={rows} />
            )}
          </div>
        );
      })}
    </div>
  );
}
