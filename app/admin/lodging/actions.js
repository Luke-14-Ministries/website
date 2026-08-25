'use server';

// Bed assignments, done by coordinators. RLS already restricts writes to
// is_coordinator(); these actions carry the rules that are judgement rather
// than permission.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

// Place one person. UNIQUE on registration_participant_id makes this an
// upsert: moving someone from Cabin 2 to Cabin 3 edits their row rather than
// leaving them in two beds at once.
export async function assignLodging({ participantId, lodgingId, note }) {
  if (!participantId || !lodgingId) {
    return { ok: false, error: 'Pick both a person and a place.' };
  }

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { error } = await supabase.from('lodging_assignments').upsert(
    {
      lodging_id: lodgingId,
      registration_participant_id: participantId,
      note: note || null,
      assigned_by: user?.id ?? null,
    },
    { onConflict: 'registration_participant_id' }
  );

  if (error) {
    console.error('assignLodging:', error.message);
    return { ok: false, error: 'That could not be saved.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

export async function unassignLodging({ participantId }) {
  if (!participantId) return { ok: false, error: 'Nothing to remove.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('lodging_assignments')
    .delete()
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('unassignLodging:', error.message);
    return { ok: false, error: 'That could not be removed.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

// Same publication gate as buddies: the RLS policy on lodging_assignments
// reads lodging_published(event_id), so until this is set a family's query
// simply returns nothing.
export async function setLodgingPublication({ eventId, publish }) {
  if (!eventId) return { ok: false, error: 'No event.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({ lodging_assignments_published_at: publish ? new Date().toISOString() : null })
    .eq('id', eventId);

  if (error) {
    console.error('setLodgingPublication:', error.message);
    return { ok: false, error: 'That could not be changed.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/account/dashboard');
  return { ok: true };
}
