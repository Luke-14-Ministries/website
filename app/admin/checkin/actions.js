'use server';

// Day-of check-in. The set_check_in RPC (migration 0011) is the real gate: it
// permits registrars, coordinators and admins, and it updates ONLY the
// check-in fields -- door duty without broader edit rights.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

// Set an event's medical contact (camp doctor / nurse). Admin-only; the
// events_write RLS policy is the real gate.
export async function setEventMedicalContact(eventId, name, phone) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) {
    return { ok: false, error: 'Only administrators can change the medical contact.' };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({
      medical_contact_name: String(name ?? '').trim() || null,
      medical_contact_phone: String(phone ?? '').trim() || null,
    })
    .eq('id', eventId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/checkin');
  revalidatePath('/admin/medical');
  return { ok: true };
}

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
