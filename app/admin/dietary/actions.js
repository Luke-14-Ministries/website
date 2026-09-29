'use server';

// Staff can set or correct a person's allergy SEVERITY (mild / severe /
// anaphylaxis / not recorded). Asked for 29 September 2026 after Testing
// Script 3 §13.3: Test Odom's allergy text said "peanuts - anaphylactic" while
// the severity field -- the one the kitchen list is colour-coded from -- was
// unset, and the only way to fix it was to ask the family to edit their own
// form. Lawrence's ruling: staff may set it, with a non-blocking reminder that
// the value must come from the family or the camp doctor, never from a guess.
//
// Guarded on `sensitive`, like every other write to person_support (its RLS
// write policy is can_view_sensitive(); a weaker guard here would produce a
// save that silently does nothing). Logged by the 0068 change-log trigger
// whoever makes the change -- allergy_severity is one of the fields that is
// logged even for staff edits, which is exactly what a staff-set value needs.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

const SEVERITIES = ['mild', 'severe', 'anaphylaxis'];

export async function setAllergySeverity({ personId, severity }) {
  if (!personId) return { ok: false, error: 'No person given.' };
  const value = severity ? String(severity) : null;
  if (value !== null && !SEVERITIES.includes(value)) {
    return { ok: false, error: 'Severity must be mild, severe, anaphylaxis, or not recorded.' };
  }

  const staff = await getStaff();
  if (!can(staff, 'sensitive')) {
    return { ok: false, error: 'Setting allergy severity needs the sensitive-information permission.' };
  }

  const supabase = await createClient();
  // update, not upsert: severity only means anything on a row that says the
  // person HAS allergies, and such a row already exists by definition.
  const { data, error } = await supabase
    .from('person_support')
    .update({ allergy_severity: value })
    .eq('person_id', personId)
    .eq('has_allergies', true)
    .select('person_id');

  if (error) {
    console.error('setAllergySeverity:', error.message);
    return { ok: false, error: 'That could not be saved.' };
  }
  if (!data?.length) {
    return { ok: false, error: 'This person has no allergies recorded, so there is no severity to set.' };
  }

  revalidatePath('/admin/dietary');
  revalidatePath('/admin/dietary/print');
  revalidatePath('/admin/medical');
  return { ok: true };
}
