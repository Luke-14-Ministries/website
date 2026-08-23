'use server';

// A family asking for help with the fee.
//
// No migration: scholarships and its row-level security have existed since
// 0001, and the policies were already written for exactly this. A family may
// insert a request for their own participant, read their own, and update it
// ONLY while status is 'requested' or 'withdrawn' AND granted_cents is 0 —
// so once staff have granted an award the family can no longer edit the
// request behind it. That rule lives in Postgres, not here.
//
// The admin side has been able to review and grant these since August; there
// was simply no way to ask.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

const MAX_CENTS = 10_000_00; // A sanity bound, not a policy. See below.

export async function requestScholarship(registrationId, participantId, input) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please log in and try again.' };
  }

  const dollars = Number(input?.amount);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, error: 'Please enter an amount, or 0 if you would rather not name one.' };
  }
  const cents = Math.round(dollars * 100);
  if (cents > MAX_CENTS) {
    return { ok: false, error: 'That amount looks like a typo — please check it.' };
  }

  const statement = (input?.statement || '').trim();

  const supabase = await createClient();

  // One request per participant. An existing one is updated rather than
  // duplicated; RLS refuses the update if staff have already granted against
  // it, which surfaces as the message below rather than a silent no-op.
  const { data: existing } = await supabase
    .from('scholarships')
    .select('id, status, granted_cents')
    .eq('registration_participant_id', participantId)
    .maybeSingle();

  if (existing) {
    if ((existing.granted_cents ?? 0) > 0) {
      return {
        ok: false,
        error:
          'Camp staff have already awarded a scholarship for this person, so this request can no longer be changed. Please contact the office if something needs to be different.',
      };
    }
    const { error } = await supabase
      .from('scholarships')
      .update({ requested_cents: cents, family_statement: statement || null, status: 'requested' })
      .eq('id', existing.id);
    if (error) return { ok: false, error: `Could not save your request: ${error.message}` };
  } else {
    const { error } = await supabase.from('scholarships').insert({
      registration_participant_id: participantId,
      requested_cents: cents,
      family_statement: statement || null,
      status: 'requested',
    });
    if (error) return { ok: false, error: `Could not save your request: ${error.message}` };
  }

  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

export async function withdrawScholarship(registrationId, participantId) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('scholarships')
    .update({ status: 'withdrawn' })
    .eq('registration_participant_id', participantId);

  if (error) return { ok: false, error: `Could not withdraw the request: ${error.message}` };
  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}
