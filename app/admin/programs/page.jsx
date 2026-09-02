import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import EventFilter from '@/components/EventFilter';
import ProgramBoard from './ProgramBoard';

export const metadata = { title: 'Programs — Staff Admin' };

// The assignment portal: who is in which program, for one event.
//
// Gated at REGISTRAR rather than coordinator, and that is not an oversight.
// The write goes through registration_participants' UPDATE policy, which is
// is_registrar(). Letting a coordinator onto a page whose Save button cannot
// save would be the worst of both worlds -- so the page is only offered to
// people whose changes will actually land.
export default async function ProgramsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/programs/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: events }, { data: programs }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on'),
    supabase
      .from('programs')
      .select('id, name, description, sort_order, active')
      .eq('active', true)
      .order('sort_order'),
  ]);

  // Same current-and-upcoming rule as the other event pages, so every staff
  // page opens on the same event.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 1);
  const horizonISO = horizon.toISOString().slice(0, 10);
  const visible = (events ?? []).filter(
    (e) => (e.ends_on ?? '9999') >= cutoff && (e.starts_on ?? '0000') <= horizonISO
  );
  const selectedId = params?.event || visible[0]?.id || null;
  const selected = (events ?? []).find((e) => e.id === selectedId) ?? null;

  // Everybody on this event's roster. Read from the tables rather than the
  // program_roster view, because staff need the household name for
  // disambiguation ("which Jacob?") and the view deliberately does not carry
  // it -- a program leader has no business knowing which family somebody
  // belongs to beyond their own program.
  const { data: participantRows } = selectedId
    ? await supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status, program_id,
           people ( id, first_name, last_name, preferred_name, date_of_birth ),
           registrations!inner ( event_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', selectedId)
        .neq('status', 'cancelled')
    : { data: [] };

  const { data: leaderRows } = selectedId
    ? await supabase
        .from('program_leaders')
        .select('id, profile_id, program_id, granted_at, is_lead, profiles ( first_name, last_name )')
        .eq('event_id', selectedId)
        .eq('active', true)
    : { data: [] };

  const people = (participantRows ?? [])
    .map((r) => ({
      participantId: r.id,
      personId: r.people?.id,
      name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim(),
      preferred: r.people?.preferred_name || null,
      dob: r.people?.date_of_birth ?? null,
      household: r.registrations?.households?.display_name ?? '',
      role: r.camp_role,
      status: r.status,
      programId: r.program_id ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const leaders = (leaderRows ?? []).map((l) => ({
    id: l.id,
    programId: l.program_id,
    name:
      [l.profiles?.first_name, l.profiles?.last_name].filter(Boolean).join(' ') ||
      'Someone with an account',
        grantedAt: l.granted_at,
    isLead: !!l.is_lead,
  }));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Programs</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Who belongs with whom for the week — nursery, children, youth, young adults, men, women.
        Families never see this and never choose it. A program leader sees only their own list,
        with flags rather than medical detail.
      </p>

      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
        }))}
        selected={selectedId}
        basePath="/admin/programs"
      />

      {!selected ? (
        <p className="text-neutral-500">No events to show.</p>
      ) : (
        <ProgramBoard
          eventId={selected.id}
          eventName={selected.name}
          eventStartsOn={selected.starts_on}
          programs={programs ?? []}
          people={people}
          leaders={leaders}
          canGrant={can(staff, 'admin')}
        />
      )}
    </div>
  );
}
