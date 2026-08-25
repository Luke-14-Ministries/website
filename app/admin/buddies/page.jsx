import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BuddyBoard from './BuddyBoard';

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
  const showPast = params?.past === '1';
  const visible = (events ?? []).filter((e) => showPast || (e.ends_on ?? '9999') >= cutoff);
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

  const campers = rows
    .filter((r) => r.camp_role !== 'volunteer')
    .map(shape)
    .filter((c) => c.buddyRequired)
    .sort((a, b) => a.name.localeCompare(b.name));

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

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {visible.map((e) => (
          <Link
            key={e.id}
            href={`/admin/buddies?event=${e.id}${showPast ? '&past=1' : ''}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              e.id === selectedId
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {e.name}
          </Link>
        ))}
        <Link
          href={`/admin/buddies?${selectedId ? `event=${selectedId}&` : ''}${showPast ? '' : 'past=1'}`}
          className="text-sm text-brand underline ml-2"
        >
          {showPast ? 'Hide past events' : 'Show past events'}
        </Link>
      </div>

      {!selected ? (
        <p className="text-neutral-500">No events to show.</p>
      ) : (
        <BuddyBoard
          eventId={selected.id}
          eventName={selected.name}
          publishedAt={selected.buddy_assignments_published_at}
          campers={campers}
          volunteers={volunteers}
          assignments={assignments}
        />
      )}
    </div>
  );
}
