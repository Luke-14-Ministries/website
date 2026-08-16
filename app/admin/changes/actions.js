'use server';

// Mark family-made changes as reviewed. Registrar-gated; the
// family_change_log_update RLS policy is the real gate (and it hides
// support-detail rows from staff without the sensitive grant).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

export async function markChangesReviewed(ids) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return { ok: false, error: 'You do not have permission to review changes.' };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from('family_change_log')
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: staff.userId })
    .in('id', ids)
    .is('reviewed_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/changes');
  return { ok: true };
}
