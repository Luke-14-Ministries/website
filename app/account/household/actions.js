'use server';

// Manage Household: families edit their own household's contact info, their
// people's basic details (incl. a phone per adult), and each person's two
// linked caregivers. RLS is the real gate everywhere: households_update /
// people_update are scoped to my_household_ids(), and person_caregivers_write
// additionally requires both ends of a link to be in the caller's household.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function updateHouseholdInfo(householdId, form) {
  const supabase = await createClient();
  const patch = {
    display_name: clean(form.display_name) ?? undefined,
    phone: clean(form.phone),
    email: clean(form.email),
    address_line1: clean(form.address_line1),
    city: clean(form.city),
    state: clean(form.state),
    postal_code: clean(form.postal_code),
  };
  // The primary contact is a PERSON in this household (migration 0037),
  // chosen from a dropdown of people we actually hold -- not a name typed
  // into a box. '' means "not set" and stores as null. RLS already scopes the
  // household; the check below additionally proves the chosen person belongs
  // to it, so a tampered form cannot point a household at a stranger.
  if ('primary_contact_person_id' in form) {
    const chosen = clean(form.primary_contact_person_id);
    if (chosen) {
      const { data: inHousehold } = await supabase
        .from('people')
        .select('id')
        .eq('id', chosen)
        .eq('household_id', householdId)
        .maybeSingle();
      if (!inHousehold) return { ok: false, error: 'That person is not in this household.' };
    }
    patch.primary_contact_person_id = chosen;
  }
  const { error } = await supabase.from('households').update(patch).eq('id', householdId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/household');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

export async function updatePersonInfo(personId, form) {
  const supabase = await createClient();
  const patch = {
    first_name: clean(form.first_name) ?? undefined,
    last_name: clean(form.last_name) ?? undefined,
    date_of_birth: clean(form.date_of_birth),
    // Blank never wipes a known value — same rule as the wizard.
    gender: clean(form.gender) ?? undefined,
    phone: clean(form.phone),
    email: clean(form.email),
  };
  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/household');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// Replace a person's caregiver links with the given pair (either may be null).
export async function setCaregivers(personId, caregiver1Id, caregiver2Id) {
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from('person_caregivers')
    .delete()
    .eq('person_id', personId);
  if (delError) return { ok: false, error: delError.message };

  const rows = [];
  if (caregiver1Id) rows.push({ person_id: personId, caregiver_person_id: caregiver1Id, position: 1 });
  if (caregiver2Id && caregiver2Id !== caregiver1Id) {
    rows.push({ person_id: personId, caregiver_person_id: caregiver2Id, position: 2 });
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('person_caregivers').insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/account/household');
  return { ok: true };
}
