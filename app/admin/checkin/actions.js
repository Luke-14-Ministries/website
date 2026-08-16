'use server';

// Day-of check-in. The set_check_in RPC (migration 0011) is the real gate: it
// permits registrars, coordinators and admins, and it updates ONLY the
// check-in fields -- door duty without broader edit rights.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

export async function toggleCheckIn(participantId, checkedIn) {
  const staff = await getStaff();
  if (!can(staff, 'door')) {
    return { ok: false, error: 'You do not have permission to check people in.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_check_in', {
    p_participant_id: participantId,
    p_checked_in: checkedIn,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/checkin');
  return { ok: true, checkedInAt: data };
}
