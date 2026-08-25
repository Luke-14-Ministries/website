'use server';

// Buddy pairing, done by coordinators.
//
// RLS on buddy_assignments is already is_coordinator() for writes, so these
// actions add the human rules rather than the permissions: never pair someone
// with themselves, never silently replace an existing pairing, and never let
// "published" happen by accident.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

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
