import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import LodgingBoard from './LodgingBoard';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Rooms & Cabins — Staff Admin' };

// Who sleeps where.
//
// Places nest: a cabin can be assigned whole (usually volunteers) or hold
// rooms that are assigned instead (usually families). The board shows both,
// and a parent's occupancy counts its children.
export default async function LodgingPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/lodging/');
  if (!can(staff, 'coordinator')) redirect('/admin');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, lodging_assignments_published_at')
    .order('starts_on');

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Current-and-upcoming decides what the page OPENS on; EventFilter reaches
  // everything else by search, so no page-level "show past" toggle any more.
  const visible = (events ?? []).filter((e) => (e.ends_on ?? '9999') >= cutoff);
  const selectedId = params?.event || visible[0]?.id || null;
  const selected = (events ?? []).find((e) => e.id === selectedId) ?? null;

  const { data: lodgingRows } = selectedId
    ? await supabase
        .from('lodgings')
        .select('id, parent_id, name, kind, capacity, accessible, accessible_notes, notes')
        .eq('event_id', selectedId)
        .eq('active', true)
        .order('sort_order')
    : { data: [] };

  // Everyone on the roster, with the facts a bed assignment turns on:
  // mobility (does this place work for them), gender (sleeping arrangements),
  // household (keep families together), role (volunteers often take a cabin).
  const { data: participantRows } = selectedId
    ? await supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status,
           people ( id, first_name, last_name, gender, date_of_birth,
             person_support ( mobility, personal_care, has_caregiver ) ),
           registrations!inner ( event_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', selectedId)
        .neq('status', 'cancelled')
    : { data: [] };

  const { data: assignmentRows } = selectedId
    ? await supabase
        .from('lodging_assignments')
        .select('id, lodging_id, registration_participant_id, note')
    : { data: [] };

  const lodgings = (lodgingRows ?? []).map((l) => ({
    id: l.id,
    parentId: l.parent_id,
    name: l.name,
    kind: l.kind,
    capacity: l.capacity,
    accessible: l.accessible,
    accessibleNotes: l.accessible_notes,
    notes: l.notes,
  }));
  const lodgingIds = new Set(lodgings.map((l) => l.id));

  const people = (participantRows ?? []).map((r) => {
    const s = r.people?.person_support ?? null;
    const support = Array.isArray(s) ? s[0] ?? null : s;
    return {
      participantId: r.id,
      name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim(),
      household: r.registrations?.households?.display_name ?? '',
      role: r.camp_role,
      gender: r.people?.gender ?? null,
      // Age, not the birth date: sleeping arrangements are decided on "is this
      // a child sharing with adults?", and a coordinator should not have to do
      // the arithmetic in their head for forty people (asked 25 Aug).
      age: (() => {
        const dob = r.people?.date_of_birth;
        if (!dob) return null;
        const [by, bm, bd] = String(dob).split('-').map(Number);
        if (!by) return null;
        const t = new Date();
        let a = t.getFullYear() - by;
        if (t.getMonth() + 1 < bm || (t.getMonth() + 1 === bm && t.getDate() < bd)) a -= 1;
        return a;
      })(),
      // Free text, not a flag -- there is no boolean for "uses a wheelchair",
      // so the presence of ANY mobility note is what triggers the access
      // warning. Better to ask twice than to put someone up a flight of stairs.
      mobility: support?.mobility || '',
      personalCare: support?.personal_care || '',
      hasCaregiver: Boolean(support?.has_caregiver),
    };
  });

  // Assignments for this event only: the query above is not event-scoped
  // (RLS gives staff every row), so filter to the places on this board.
  const assignments = (assignmentRows ?? [])
    .filter((a) => lodgingIds.has(a.lodging_id))
    .map((a) => ({
      id: a.id,
      lodgingId: a.lodging_id,
      participantId: a.registration_participant_id,
      note: a.note,
    }));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Rooms &amp; Cabins</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Cabins can be assigned whole, or hold rooms that are assigned instead. Families see
        nothing here until you publish.
      </p>

      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
        }))}
        selected={selectedId}
        basePath="/admin/lodging"
      />

      {!selected ? (
        <p className="text-neutral-500">No events to show.</p>
      ) : lodgings.length === 0 ? (
        <p className="text-neutral-500">
          No cabins or rooms are set up for this event yet.
        </p>
      ) : (
        <LodgingBoard
          eventId={selected.id}
          eventName={selected.name}
          publishedAt={selected.lodging_assignments_published_at}
          lodgings={lodgings}
          people={people}
          assignments={assignments}
        />
      )}
    </div>
  );
}
