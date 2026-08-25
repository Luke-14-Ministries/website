'use server';

// Cancellation requests, raised by a family and settled by staff.
//
// The family side of this deliberately cannot cancel anything. It records the
// ask. Staff release the places and settle any money, because both of those
// depend on a refund rule that is the board's to make, and because a place
// released by accident at eleven at night is not easily un-released.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export async function requestCancellation({ registrationId, participantIds, reason }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };
  if (!registrationId) return { ok: false, error: 'Which registration?' };
  if (!(reason || '').trim()) {
    // Not a database rule, a working one: staff ring the family about these,
    // and "no reason given" makes that call start from nothing. It also gives
    // the ministry a chance to help with whatever the real problem is —
    // which, often enough, is money we could have covered.
    return {
      ok: false,
      error: 'Please tell us briefly why, so staff know how to help.',
    };
  }

  const supabase = await createClient();

  // One open request at a time. A family clicking twice should not produce two
  // queue items staff have to reconcile against each other.
  const { data: existing } = await supabase
    .from('registration_cancellation_requests')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('status', 'open')
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: 'You already have a cancellation request open for this registration — staff will be in touch.',
    };
  }

  const { error } = await supabase.from('registration_cancellation_requests').insert({
    registration_id: registrationId,
    participant_ids: Array.isArray(participantIds) ? participantIds : [],
    reason: reason.trim(),
    requested_by: user.id,
  });

  if (error) {
    console.error('requestCancellation:', error.message);
    return { ok: false, error: 'That request could not be sent. Please try again.' };
  }

  revalidatePath('/account/dashboard');
  revalidatePath('/admin/cancellations');
  return { ok: true };
}

// A family may take back a request staff have not acted on. RLS already
// refuses one that has been handled; this sets the only transition the family
// side is allowed to make.
export async function withdrawCancellation({ requestId }) {
  if (!requestId) return { ok: false, error: 'Nothing to withdraw.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_cancellation_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'open');

  if (error) {
    console.error('withdrawCancellation:', error.message);
    return { ok: false, error: 'That could not be withdrawn — staff may already have acted on it.' };
  }

  revalidatePath('/account/dashboard');
  revalidatePath('/admin/cancellations');
  return { ok: true };
}
