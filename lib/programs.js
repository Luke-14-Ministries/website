// Which programs, at which events, does the person signed in lead?
//
// Server-only, and deliberately small. A program leader is NOT staff: they
// have no row in `staff`, no role, and none of the permissions in lib/staff.js.
// What they have is one or more grants in `program_leaders`, each naming one
// program at one event, and the only thing a grant buys is the right to read
// `program_roster` filtered to that program (migration 0061).
//
// The RLS behind this: program_leaders lets a person read their OWN grants,
// programs lets any active leader read the list of program names, and events
// lets anyone read a PUBLISHED event. An unpublished event therefore comes
// back with no name -- handled below rather than crashing, because a leader
// granted early (before the event is published) should still see their page.

import { createClient } from '@/lib/supabase/server';

export async function getProgramLeadership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('program_leaders')
    .select(
      `id, program_id, event_id, granted_at,
       programs ( name, description, sort_order ),
       events ( name, starts_on, ends_on )`
    )
    .eq('profile_id', user.id)
    .eq('active', true);

  if (error) {
    // Never throw here: this runs in the admin layout, and a failure to read
    // leadership must not take down the staff area for actual staff.
    console.error('getProgramLeadership:', error.message);
    return [];
  }

  return (data ?? [])
    .map((g) => ({
      id: g.id,
      programId: g.program_id,
      programName: g.programs?.name ?? 'Your program',
      eventId: g.event_id,
      eventName: g.events?.name ?? 'This event',
      startsOn: g.events?.starts_on ?? null,
      endsOn: g.events?.ends_on ?? null,
      sortOrder: g.programs?.sort_order ?? 100,
    }))
    .sort(
      (a, b) =>
        (a.startsOn ?? '').localeCompare(b.startsOn ?? '') || a.sortOrder - b.sortOrder
    );
}

// The roster a leader is allowed to see. Reads the VIEW, never the tables:
// `program_roster` carries flags where the underlying rows carry medical
// text, and that difference is the whole permission (0061). Staff get the
// same view unfiltered by leadership, which is what the assignment portal
// uses for its counts.
export async function getProgramRoster({ programId, eventId }) {
  if (!programId || !eventId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('program_roster')
    .select('*')
    .eq('program_id', programId)
    .eq('event_id', eventId);

  if (error) {
    console.error('getProgramRoster:', error.message);
    return [];
  }
  return data ?? [];
}

// Age at the start of the event, not age today. A leader reading a roster in
// June for a camp in August wants the age the child will BE at camp, and a
// birthday in July is exactly when the two answers differ.
export function ageAt(dateOfBirth, onDate) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// Who leads this program at this event, lead first. Goes through a SECURITY
// DEFINER function (0072) rather than the table, because under RLS a leader
// may read only their OWN grant row -- and the whole point here is to show a
// leader who their co-leader is. The function returns names and the lead flag,
// nothing else, and only to staff or to a leader of that same program.
export async function getProgramLeaders({ programId, eventId }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('program_leaders_for', {
    p_program_id: programId,
    p_event_id: eventId,
  });
  if (error) {
    console.error('getProgramLeaders:', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({ name: r.display_name, isLead: !!r.is_lead }));
}
