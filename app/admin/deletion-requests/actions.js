'use server';

// Staff closing a data deletion request (Lawrence, 30 Sep 2026). Like the
// cancellation queue, this records that a person dealt with it and what they
// did; the deleting itself is done deliberately, by hand, because payments,
// signed releases and background checks must be kept for a time (retention:
// three years) and only a person can tell what may go.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export async function settleDeletionRequest({ requestId, status, staffNote }) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!requestId) return { ok: false, error: 'Which request?' };
  if (!['done', 'declined'].includes(status)) return { ok: false, error: 'That is not a way to close a request.' };
  if (!(staffNote || '').trim()) {
    return { ok: false, error: 'Please note what was deleted (or why not) — the family sees this.' };
  }
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('data_deletion_requests')
    .update({ status, staff_note: staffNote.trim(), handled_by: user?.id ?? null, handled_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'requested');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/deletion-requests');
  return { ok: true };
}
