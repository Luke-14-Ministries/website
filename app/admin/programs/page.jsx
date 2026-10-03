import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { eventWindow, staffAssigns } from '@/lib/events';
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
  if (!staff) await bounceNonStaff('/admin/programs/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: allEvents }, { data: programs }] = await Promise.all([
    supabase.from('events').select('id, name, event_type, starts_on, ends_on').order('starts_on'),
    supabase
      .from('programs')
      .select('id, name, description, sort_order, active')
      .eq('active', true)
      .order('sort_order'),
  ]);

  // Retreats are sorted on arrival, not assigned here (2 Oct 2026; see
  // staffAssigns in lib/events.js).
  const events = (allEvents ?? []).filter(staffAssigns);

  // Same current-and-upcoming rule as the other event pages, so every staff
  // page opens on the same event.
  const { cutoff, horizon: horizonISO } = eventWindow();
  const visible = (events ?? []).filter(
    (e) => (e.ends_on ?? '9999') >= cutoff && (e.starts_on ?? '0000') <= horizonISO
  );
  // A retreat's id in the URL falls back to the first camp event rather than
  // drawing a board for something that is sorted on arrival.
  const selectedId =
    (params?.event && (events ?? []).some((e) => e.id === params.event) ? params.event : null) ||
    visible[0]?.id ||
    null;
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

  // The FK hint is not optional. program_leaders has TWO foreign keys to
  // profiles (profile_id, the leader; granted_by, the administrator), so a
  // bare `profiles ( ... )` is ambiguous and PostgREST refuses the whole query
  // with PGRST201. Until 29 Sep 2026 that error was dropped on the floor and
  // every card read "No leader named" while the grants sat in the database --
  // Testing Script 3 §5.3/§5.6, and the "reported twice" mystery in
  // ProgramBoard. Errors on this page are logged, never swallowed.
  const { data: leaderRows, error: leaderError } = selectedId
    ? await supabase
        .from('program_leaders')
        .select(
          'id, profile_id, program_id, granted_at, is_lead, profiles!program_leaders_profile_id_fkey ( first_name, last_name )'
        )
        .eq('event_id', selectedId)
        .eq('active', true)
    : { data: [], error: null };
  if (leaderError) console.error('programs: leaders query failed:', leaderError.message);

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
