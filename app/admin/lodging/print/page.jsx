import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { eventWindow } from '@/lib/events';
import PrintButton from '@/components/PrintButton';

export const metadata = { title: 'Room List — Staff Admin' };

// The room list on paper: one section per building, every room with the
// venue's bed description and who is in it, then whoever has no place yet.
// Added 29 September 2026 alongside the real Carson Springs inventory (0076)
// -- the sheet that gets taped up at the lodge desk and carried round on
// arrival day.
//
// WHAT IT DELIBERATELY DOES NOT CARRY. Names, role, age and household, and
// nothing else. No mobility notes, no personal-care text, no rooming
// preferences, no caregiver flag -- all of which the board on the screen
// shows, because the board is where the decision is made and those facts are
// the decision. This sheet is paper, and paper gets left on a table. The
// columns holding that detail are not selected at all, so they cannot reach
// the page by accident later. Same line as the activity sheets and the
// kitchen list.
//
// Guarded on `coordinator`, matching the board it prints from.

const KIND_LABEL = {
  cabin: 'Cabin',
  room: 'Room',
  tent: 'Tent',
  lodge: 'Lodge',
  building: 'Building',
  rv: 'RV site',
  offsite: 'Off site',
};

const ROLE_SHORT = {
  camper: 'camper',
  parent_guardian: 'parent',
  sibling: 'sibling',
  caregiver: 'caregiver',
  volunteer: 'volunteer',
  childcare: 'childcare',
  support_team: 'support',
};

function ageOn(dob, onDate) {
  if (!dob) return null;
  const [by, bm, bd] = String(dob).split('-').map(Number);
  if (!by) return null;
  const t = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(t.getTime())) return null;
  let a = t.getFullYear() - by;
  if (t.getMonth() + 1 < bm || (t.getMonth() + 1 === bm && t.getDate() < bd)) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

// Hoisted, never defined inside the page (CLAUDE.md, working rules).
//
// The first column is an empty box to tick -- the sheet is carried round on
// arrival day and "have they turned up?" is what it gets used for. Drawn with
// a border rather than a checkbox input, so it prints the same in every
// browser and is not clickable on the screen.
function Occupants({ rows }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-400">&mdash; empty &mdash;</p>;
  return (
    <table className="w-full border-collapse text-left text-sm">
      <tbody>
        {rows.map((p) => (
          <tr key={p.participantId} className="border-b border-neutral-200">
            <td className="w-6 py-0.5 pr-2">
              <span
                aria-hidden="true"
                className="inline-block h-3.5 w-3.5 border border-neutral-700 align-middle"
              />
            </td>
            <td className="w-1/2 py-0.5 pr-3 font-medium">{p.name}</td>
            <td className="py-0.5 pr-3 text-neutral-600">{ROLE_SHORT[p.role] ?? p.role}</td>
            <td className="py-0.5 pr-3 text-neutral-600">{p.age != null ? p.age : ''}</td>
            <td className="py-0.5 text-neutral-600">{p.household}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function RoomListPrintPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/lodging/print/');
  if (!can(staff, 'coordinator')) redirect('/admin');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .order('starts_on');

  // Without ?event=, open on the same event the board opens on -- the first
  // current-or-upcoming one -- so a bare link never prints last year's camp.
  const { cutoff, horizon } = eventWindow();
  const fallback = (events ?? []).find(
    (e) => (e.ends_on ?? '9999') >= cutoff && (e.starts_on ?? '0000') <= horizon
  );
  const selected =
    (typeof params?.event === 'string' && params.event) || fallback?.id || null;
  const event = (events ?? []).find((e) => e.id === selected) ?? null;

  // Query errors are logged, never dropped: a failed query here would print
  // a sheet that says every room is empty.
  const { data: lodgingRows, error: lodgingError } = selected
    ? await supabase
        .from('lodgings')
        .select('id, parent_id, name, kind, capacity, beds, sort_order')
        .eq('event_id', selected)
        .eq('active', true)
        .order('sort_order')
    : { data: [], error: null };
  if (lodgingError) console.error('room list: lodgings query failed:', lodgingError.message);

  // Only the four facts the sheet carries. person_support is not joined.
  const { data: participantRows, error: participantError } = selected
    ? await supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status,
           people ( first_name, last_name, date_of_birth ),
           registrations!inner ( event_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', selected)
        .neq('status', 'cancelled')
    : { data: [], error: null };
  if (participantError) {
    console.error('room list: participants query failed:', participantError.message);
  }

  const { data: assignmentRows, error: assignmentError } = selected
    ? await supabase.from('lodging_assignments').select('lodging_id, registration_participant_id')
    : { data: [], error: null };
  if (assignmentError) {
    console.error('room list: assignments query failed:', assignmentError.message);
  }

  const lodgings = lodgingRows ?? [];
  const lodgingIds = new Set(lodgings.map((l) => l.id));
  const childrenOf = new Map();
  for (const l of lodgings) {
    if (!l.parent_id) continue;
    if (!childrenOf.has(l.parent_id)) childrenOf.set(l.parent_id, []);
    childrenOf.get(l.parent_id).push(l);
  }
  const roots = lodgings.filter((l) => !l.parent_id);

  const people = (participantRows ?? []).map((r) => ({
    participantId: r.id,
    name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim() || 'Unnamed',
    role: r.camp_role,
    // Age at the start of camp, since that is when the sheet is used.
    age: ageOn(r.people?.date_of_birth, event?.starts_on),
    household: r.registrations?.households?.display_name ?? '',
  }));
  const peopleById = new Map(people.map((p) => [p.participantId, p]));

  // Assignments are not event-scoped in the query (staff RLS is broad), so
  // keep only those pointing at a place on this event.
  const byLodging = new Map();
  const placed = new Set();
  for (const a of assignmentRows ?? []) {
    if (!lodgingIds.has(a.lodging_id)) continue;
    const p = peopleById.get(a.registration_participant_id);
    if (!p) continue;
    if (!byLodging.has(a.lodging_id)) byLodging.set(a.lodging_id, []);
    byLodging.get(a.lodging_id).push(p);
    placed.add(p.participantId);
  }
  const byName = (a, b) => a.household.localeCompare(b.household) || a.name.localeCompare(b.name);
  for (const list of byLodging.values()) list.sort(byName);
  const unplaced = people.filter((p) => !placed.has(p.participantId)).sort(byName);

  const countIn = (l) =>
    (byLodging.get(l.id) ?? []).length +
    (childrenOf.get(l.id) ?? []).reduce((s, k) => s + countIn(k), 0);

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Room list</h1>
        <PrintButton />
      </div>
      <p className="mb-6 text-sm text-neutral-500 print:hidden">
        Who is in each room, by building. Names, role, age and household only &mdash; mobility
        and care notes stay on the Rooms &amp; Cabins screen, because this sheet is paper and
        paper gets left on a table.
      </p>

      <p className="mb-6 text-sm font-semibold">
        {event ? `${event.name} · ${event.starts_on} – ${event.ends_on}` : 'No event selected'}
        {event && (
          <span className="ml-2 font-normal text-neutral-500">
            {people.length - unplaced.length} of {people.length} placed
          </span>
        )}
      </p>

      {roots.length === 0 && (
        <p className="text-sm text-neutral-500">No rooms or buildings are set up for this event.</p>
      )}

      {/* One building per block, kept together where the printer can. A
          building that is assigned whole (a cabin) lists its people directly;
          one that holds rooms lists each room. */}
      {roots.map((b) => {
        const rooms = childrenOf.get(b.id) ?? [];
        const own = byLodging.get(b.id) ?? [];
        return (
          <div key={b.id} className="mb-8 break-inside-avoid">
            <h2 className="mb-2 border-b-2 border-neutral-800 pb-1 text-lg font-bold">
              {b.name}
              <span className="ml-2 text-sm font-normal text-neutral-500">
                {KIND_LABEL[b.kind] ?? b.kind}
                {b.beds ? ` · ${b.beds}` : ''} · {countIn(b)}
                {b.capacity != null ? ` of ${b.capacity}` : ''}
              </span>
            </h2>

            {own.length > 0 && (
              <div className="mb-3">
                <Occupants rows={own} />
              </div>
            )}

            {rooms.map((r) => {
              const here = byLodging.get(r.id) ?? [];
              return (
                <div key={r.id} className="mb-3 break-inside-avoid">
                  <p className="mb-0.5 text-sm font-semibold">
                    {r.name}
                    <span className="ml-2 font-normal text-neutral-500">
                      {r.beds ? `${r.beds} · ` : ''}
                      {here.length}
                      {r.capacity != null ? ` of ${r.capacity}` : ''}
                    </span>
                  </p>
                  <Occupants rows={here} />
                </div>
              );
            })}

            {rooms.length === 0 && own.length === 0 && (
              <p className="text-sm text-neutral-400">&mdash; empty &mdash;</p>
            )}
          </div>
        );
      })}

      {/* Whoever still has no bed, on the same sheet: the failure a paper
          list exists to catch is the person nobody can find a room for. */}
      {event && (
        <div className="mb-8 break-inside-avoid">
          <h2 className="mb-2 border-b-2 border-neutral-800 pb-1 text-lg font-bold">
            Not yet placed
            <span className="ml-2 text-sm font-normal text-neutral-500">{unplaced.length}</span>
          </h2>
          {unplaced.length === 0 ? (
            <p className="text-sm text-neutral-500">Everyone has somewhere to sleep.</p>
          ) : (
            <Occupants rows={unplaced} />
          )}
        </div>
      )}

      <p className="mt-8 text-xs text-neutral-400">
        Support and access notes withheld on purpose &mdash; see the Rooms &amp; Cabins screen.
        Printed {new Date().toLocaleDateString('en-US')} · Luke 14 Ministries.
      </p>
    </div>
  );
}
