import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RosterTable from './RosterTable';

export const metadata = { title: 'Rosters — Staff Admin' };

// Server side just loads the data; RosterTable (client) owns filtering,
// sorting, and building the CSV/print links so the download always matches
// exactly what's on screen.
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

  const rows = [];
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      rows.push({
        eventId: r.event_id,
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
      <h2 className="text-xl font-bold mb-1">Rosters</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Everyone registered, by event — filter below, click a column heading to sort. The CSV
        download matches whatever is filtered on screen. Select a household to review it, change
        a status, or add and edit people.
      </p>

      <RosterTable
        events={(events ?? []).map((e) => ({ id: e.id, name: e.name }))}
        rows={rows}
      />
    </div>
  );
}
