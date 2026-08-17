'use server';

// Staff-side volunteer actions. Registrar-gated here AND by row-level
// security (volunteer_applications_update allows registrars; the
// volunteer_clearances policy is registrar-only in both directions).

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export async function reviewVolunteerApplication(participantId, decision) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!['approved', 'declined', 'applied'].includes(decision)) {
    return { ok: false, error: 'Unknown decision.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('volunteer_applications')
    .update({ status: decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString() })
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('reviewVolunteerApplication:', error.message);
    return { ok: false, error: 'Could not save the decision.' };
  }
  revalidatePath('/admin/volunteers');
  return { ok: true };
}

export async function setVolunteerClearance({ personId, onFile, date, expires }) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!personId) return { ok: false, error: 'Missing person.' };

  const supabase = await createClient();
  const { error } = await supabase.from('volunteer_clearances').upsert(
    {
      person_id: personId,
      background_check_on_file: Boolean(onFile),
      background_check_date: date || null,
      expires_on: expires || null,
      recorded_by: staff.userId,
    },
    { onConflict: 'person_id' }
  );

  if (error) {
    console.error('setVolunteerClearance:', error.message);
    return { ok: false, error: 'Could not save the record.' };
  }
  revalidatePath('/admin/volunteers');
  return { ok: true };
}
