'use server';

// Buddy pairing, done by coordinators.
//
// RLS on buddy_assignments is already is_coordinator() for writes, so these
// actions add the human rules rather than the permissions: never pair someone
// with themselves, never silently replace an existing pairing, and never let
// "published" happen by accident.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

export async function assignBuddy({ eventId, camperParticipantId, buddyParticipantId, note }) {
  if (!eventId || !camperParticipantId || !buddyParticipantId) {
    return { ok: false, error: 'Pick both a camper and a buddy.' };
  }
  if (camperParticipantId === buddyParticipantId) {
    return { ok: false, error: 'Someone cannot be their own buddy.' };
  }

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { error } = await supabase.from('buddy_assignments').insert({
    event_id: eventId,
    camper_participant_id: camperParticipantId,
    buddy_participant_id: buddyParticipantId,
    started_at: new Date().toISOString(),
    assigned_by: user?.id ?? null,
    note: note || null,
  });

  if (error) {
    if (/duplicate key/i.test(error.message)) {
      return { ok: false, error: 'Those two are already paired.' };
    }
    console.error('assignBuddy:', error.message);
    return { ok: false, error: 'That pairing could not be saved.' };
  }

  revalidatePath('/admin/buddies');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

// Ending a pairing sets ended_at rather than deleting the row. Who was paired
// with whom during a week is exactly the sort of thing someone needs to
// reconstruct afterwards, and a delete makes that unanswerable.
export async function unassignBuddy({ assignmentId }) {
  if (!assignmentId) return { ok: false, error: 'Nothing to remove.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('buddy_assignments')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .is('ended_at', null);

  if (error) {
    console.error('unassignBuddy:', error.message);
    return { ok: false, error: 'That pairing could not be ended.' };
  }

  revalidatePath('/admin/buddies');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

// Publishing is what makes assignments visible to families -- the RLS policy
// on buddy_assignments reads buddies_published(event_id), which reads this
// timestamp. Until it is set, families see nothing, which is the right default:
// pairing gets drafted and reshuffled before anyone should be told.
export async function setBuddyPublication({ eventId, publish }) {
  if (!eventId) return { ok: false, error: 'No event.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({ buddy_assignments_published_at: publish ? new Date().toISOString() : null })
    .eq('id', eventId);

  if (error) {
    console.error('setBuddyPublication:', error.message);
    return { ok: false, error: 'That could not be changed.' };
  }

  revalidatePath('/admin/buddies');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// Mark someone as needing a one-to-one buddy, or unmark them.
//
// This used to be a question on the family's own support form. It was removed
// on 31 August 2026: families are not asked at registration, because the family
// coordinator follows up with each family to work out what support is actually
// needed, and a yes/no ticked months earlier by somebody guessing at the term
// was a worse input to that conversation than no answer.
//
// So the flag needed a home, and this is it — the page where the coordinator
// already works, and where a follow-up phone call actually gets recorded.
//
// Guarded on `sensitive` rather than `coordinator`. Whether a child needs
// one-to-one support is support information, and person_support's RLS agrees:
// its write policy is can_view_sensitive(). Guarding on anything weaker here
// would just produce a save that silently does nothing.
//
// upsert, not update: a person can reach camp with no person_support row at
// all, and a coordinator marking them should not fail on that.
export async function setBuddyRequired({ personId, required }) {
  if (!personId) return { ok: false, error: 'No person given.' };

  const staff = await getStaff();
  if (!can(staff, 'sensitive')) {
    return {
      ok: false,
      error: 'Marking who needs a buddy needs the sensitive-information permission.',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('person_support')
    .upsert(
      {
        person_id: personId,
        // Three states (0066): true needs one, false decided against, null
        // nobody has decided. `required === true` would have collapsed null
        // into false and quietly excused everybody nobody had looked at.
        buddy_required: required === true ? true : required === false ? false : null,
      },
      { onConflict: 'person_id' }
    );

  if (error) {
    console.error('setBuddyRequired:', error.message);
    return { ok: false, error: 'That could not be saved.' };
  }

  revalidatePath('/admin/buddies');
  revalidatePath('/admin/checkin');
  return { ok: true };
}
