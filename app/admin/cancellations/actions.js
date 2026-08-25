'use server';

// Staff settling a cancellation request.
//
// Note what this does NOT do: it never releases a place and never moves money.
// Both of those are deliberate acts with their own screens, and both are hard
// to undo. This records that a human dealt with the request, and what they
// did -- so the queue reflects reality rather than becoming a second, quieter
// source of truth about who is coming.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export async function settleCancellation({ requestId, status, staffNote }) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!requestId) return { ok: false, error: 'Which request?' };
  if (!['actioned', 'declined'].includes(status)) {
    return { ok: false, error: 'That is not a way to settle a request.' };
  }

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('registration_cancellation_requests')
    .update({
      status,
      staff_note: (staffNote || '').trim() || null,
      handled_by: user?.id ?? null,
      handled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'open');

  if (error) {
    console.error('settleCancellation:', error.message);
    return { ok: false, error: 'That could not be saved.' };
  }

  revalidatePath('/admin/cancellations');
  revalidatePath('/account/dashboard');
  return { ok: true };
}
