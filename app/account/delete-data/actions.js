'use server';

// A family asks the ministry to delete their medical information, or their
// whole account (Lawrence, 30 Sep 2026). This records the ask and nothing
// else: staff act on it, because some records -- payments, signed releases,
// background checks -- have to be kept for a time (retention policy: three
// years), and a person decides what can go.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export async function requestDataDeletion({ scope, note }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };
  if (!['medical', 'account_and_medical'].includes(scope)) {
    return { ok: false, error: 'Please choose what you would like deleted.' };
  }

  const supabase = await createClient();
  const { data: member } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!member?.household_id) {
    return { ok: false, error: 'There is no family record on this account yet, so there is nothing to delete.' };
  }

  // One open request at a time.
  const { data: open } = await supabase
    .from('data_deletion_requests')
    .select('id')
    .eq('household_id', member.household_id)
    .eq('status', 'requested')
    .limit(1)
    .maybeSingle();
  if (open) return { ok: false, error: 'You already have a request open. Staff will be in touch.' };

  const { error } = await supabase.from('data_deletion_requests').insert({
    household_id: member.household_id,
    requested_by: user.id,
    scope,
    family_note: (note || '').trim().slice(0, 2000) || null,
  });
  if (error) {
    console.error('requestDataDeletion:', error.message);
    return { ok: false, error: 'Your request could not be saved. Please try again, or email registration@luke14ministries.net.' };
  }
  revalidatePath('/account/delete-data');
  revalidatePath('/admin/deletion-requests');
  return { ok: true };
}
