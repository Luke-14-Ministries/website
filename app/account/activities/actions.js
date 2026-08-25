'use server';

// Activity choices, made by the family for their own people.
//
// Row-level security already scopes activity_signups to my_participant_ids(),
// so a family physically cannot write a choice onto someone else's place --
// these actions add the human-readable errors and the rules that are policy
// rather than permission (capacity, closed windows, waiver acknowledgement).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// One activity choice for one person.
//
// `status` is the schema's own vocabulary and the three values mean genuinely
// different things:
//   interested  -- "we'd like to" on an interest-mode activity. Holds nothing.
//   signed_up   -- a place is taken. Counts against capacity.
//   cancelled   -- they had one and gave it back. Kept rather than deleted so
//                  staff can see a place was released, not that it never was.
export async function setActivityChoice({ participantId, activityId, status, acknowledgeWaiver }) {
  if (!participantId || !activityId) {
    return { ok: false, error: 'Something is missing — please refresh and try again.' };
  }
  if (!['interested', 'signed_up', 'cancelled'].includes(status)) {
    return { ok: false, error: 'That is not a choice we recognise.' };
  }

  const supabase = await createClient();

  const { data: activity, error: actError } = await supabase
    .from('activities')
    .select('id, name, booking_mode, capacity, provider_name, provider_url, active, signup_opens_at, signup_closes_at')
    .eq('id', activityId)
    .maybeSingle();
  if (actError || !activity) return { ok: false, error: 'That activity could not be found.' };
  if (!activity.active) return { ok: false, error: 'That activity is not open at the moment.' };

  // Signup windows, checked on the server because a page left open overnight
  // is the normal way a closed window gets a late write.
  const now = Date.now();
  if (activity.signup_opens_at && new Date(activity.signup_opens_at).getTime() > now) {
    return { ok: false, error: 'Sign-ups for this one have not opened yet.' };
  }
  if (activity.signup_closes_at && new Date(activity.signup_closes_at).getTime() < now) {
    return { ok: false, error: 'Sign-ups for this one have closed — please ask camp staff.' };
  }

  // A provider-run activity cannot be taken without the family being told that
  // the provider's own paperwork is theirs to complete. We record the
  // acknowledgement; we never record a waiver as signed, because we cannot
  // know that and a column that claimed to would eventually be believed.
  const needsAck = Boolean(activity.provider_url || activity.provider_name);
  if (status === 'signed_up' && needsAck && !acknowledgeWaiver) {
    return {
      ok: false,
      error: `${activity.name} is run by an outside provider. Please tick to confirm you understand their own form has to be completed with them.`,
    };
  }

  const row = {
    registration_participant_id: participantId,
    activity_id: activityId,
    status,
    added_source: 'family',
    waiver_acknowledged_at:
      status === 'signed_up' && needsAck && acknowledgeWaiver ? new Date().toISOString() : null,
  };

  // UNIQUE (registration_participant_id, activity_id) makes this an upsert --
  // changing your mind edits the same row rather than stacking choices.
  const { error } = await supabase
    .from('activity_signups')
    .upsert(row, { onConflict: 'registration_participant_id,activity_id' });

  if (error) {
    // The capacity trigger speaks SQL; a family should not have to.
    if (/activity full/i.test(error.message)) {
      return {
        ok: false,
        error: `${activity.name} is full. Camp staff keep a list — email info@luke14ministries.net and they will add you.`,
      };
    }
    console.error('setActivityChoice:', error.message);
    return { ok: false, error: 'That choice could not be saved. Please try again.' };
  }

  revalidatePath('/account/activities');
  revalidatePath('/account/dashboard');
  revalidatePath('/admin/activities');
  return { ok: true };
}
