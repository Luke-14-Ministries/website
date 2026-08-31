import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BuddyBoard from './BuddyBoard';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Buddy Assignments — Staff Admin' };

// Pairing campers who asked for a one-to-one buddy with the volunteers who
// can be one.
//
// Two things this page refuses to do quietly:
//   1. Pair without showing what the camper actually needs. Pairing from names
//      alone is guesswork, and the support profile is the whole reason one
//      volunteer suits a camper better than another.
//   2. Let a volunteer with no cleared background check look the same as one
//      who has. It warns; it does not block -- clearances arrive late and
//      pairing happens early -- but it is never discovered in the last week.
export default async function BuddiesPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/buddies/');
  if (!can(staff, 'coordinator')) redirect('/admin');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, buddy_assignments_published_at')
    .order('starts_on');

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Current-and-upcoming decides what the page OPENS on; EventFilter reaches
  // everything else by search, so no page-level "show past" toggle any more.
  // Same twelve-month horizon the pill row uses (EventFilter), so the event
  // this page OPENS on is always one that has a pill. Without it a week booked
  // three years out would be selected by default and appear nowhere.
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 1);
  const horizonISO = horizon.toISOString().slice(0, 10);
  const visible = (events ?? []).filter(
    (e) => (e.ends_on ?? '9999') >= cutoff && (e.starts_on ?? '0000') <= horizonISO
  );
  const selectedId = params?.event || visible[0]?.id || null;
  const selected = (events ?? []).find((e) => e.id === selectedId) ?? null;

  // Everyone on this event's roster, with the support facts pairing depends on.
  const { data: participants } = selectedId
    ? await supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status,
           people ( id, first_name, last_name, date_of_birth,
             person_support ( buddy_required, buddy_ratio, communication, mobility,
               personal_care, behaviour_triggers, redirection_strategies,
               has_seizures, has_allergies ) ),
           registrations!inner ( event_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', selectedId)
        .neq('status', 'cancelled')
    : { data: [] };

  const rows = participants ?? [];

  const { data: assignmentRows } = selectedId
    ? await supabase
        .from('buddy_assignments')
        .select('id, camper_participant_id, buddy_participant_id, note, started_at')
        .eq('event_id', selectedId)
        .is('ended_at', null)
    : { data: [] };

  // Clearance state for the volunteers on this roster. Read separately because
  // it is keyed by person, not by participant, and a volunteer who comes two
  // years running has one clearance record, not two.
  const volunteerPersonIds = rows
    .filter((r) => r.camp_role === 'volunteer')
    .map((r) => r.people?.id)
    .filter(Boolean);

  const { data: clearanceRows } = volunteerPersonIds.length
    ? await supabase
        .from('volunteer_clearances')
        .select('person_id, background_check_on_file, expires_on, checkr_status')
        .in('person_id', volunteerPersonIds)
    : { data: [] };

  const today = new Date().toISOString().slice(0, 10);
  const clearanceByPerson = new Map();
  for (const c of clearanceRows ?? []) {
    const expired = c.expires_on && c.expires_on < today;
    clearanceByPerson.set(c.person_id, {
      cleared: Boolean(c.background_check_on_file) && !expired,
      expired: Boolean(expired),
      status: c.checkr_status ?? null,
    });
  }

  const shape = (r) => {
    const s = r.people?.person_support ?? null;
    const support = Array.isArray(s) ? s[0] ?? null : s;
    return {
      participantId: r.id,
      personId: r.people?.id,
      name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim(),
      household: r.registrations?.households?.display_name ?? '',
      role: r.camp_role,
      buddyRequired: Boolean(support?.buddy_required),
      buddyRatio: support?.buddy_ratio ?? null,
      // Only the facts that bear on WHO should be paired with them. This page
      // deliberately does not become a second medical page.
      support: support
        ? {
            communication: support.communication || '',
            mobility: support.mobility || '',
            personalCare: support.personal_care || '',
            triggers: support.behaviour_triggers || '',
            helps: support.redirection_strategies || '',
            seizures: Boolean(support.has_seizures),
            allergies: Boolean(support.has_allergies),
          }
        : null,
      clearance: clearanceByPerson.get(r.people?.id) ?? null,
    };
  };

  const allCampers = rows
    .filter((r) => r.camp_role !== 'volunteer')
    .map(shape)
    .sort((a, b) => a.name.localeCompare(b.name));

  // The board itself still shows only those who need a buddy — that is what it
  // is for. The rest travel separately so a coordinator can mark somebody after
  // a follow-up call, which is now the only way this flag is ever set: families
  // stopped being asked on 31 Aug 2026. Without this list the board would empty
  // itself over a season and there would be no way to refill it.
  const campers = allCampers.filter((c) => c.buddyRequired);
  const otherCampers = allCampers.filter((c) => !c.buddyRequired);

  const volunteers = rows
    .filter((r) => r.camp_role === 'volunteer')
    .map(shape)
    .sort((a, b) => a.name.localeCompare(b.name));

  const assignments = (assignmentRows ?? []).map((a) => ({
    id: a.id,
    camperParticipantId: a.camper_participant_id,
    buddyParticipantId: a.buddy_participant_id,
    note: a.note,
    startedAt: a.started_at,
  }));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Buddy Assignments</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Campers who asked for a one-to-one buddy, and the volunteers who can be one.
        Families see nothing here until you publish.
      </p>

      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
        }))}
        selected={selectedId}
        basePath="/admin/buddies"
      />

      {!selected ? (
        <p className="text-neutral-500">No events to show.</p>
      ) : (
        <BuddyBoard
          eventId={selected.id}
          eventName={selected.name}
          publishedAt={selected.buddy_assignments_published_at}
          campers={campers}
          otherCampers={otherCampers}
          canMark={can(staff, 'sensitive')}
          volunteers={volunteers}
          assignments={assignments}
        />
      )}
    </div>
  );
}
