'use server';

// Manage Household: families edit their own household's contact info, their
// people's basic details (incl. a phone per adult), and each person's two
// linked caregivers. RLS is the real gate everywhere: households_update /
// people_update are scoped to my_household_ids(), and person_caregivers_write
// additionally requires both ends of a link to be in the caller's household.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// A deliberately loose check: something@something.tld. Anything stricter
// starts rejecting addresses that genuinely work, and the cost of a false
// refusal here (a family cannot save) is far worse than a typo we catch later.
const emailLooksValid = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function updateHouseholdInfo(householdId, form) {
  if (!emailLooksValid(form.email)) {
    return { ok: false, error: 'That email address doesn’t look right — please check it.' };
  }
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

  // A cleared name used to be dropped from the patch and the save then
  // reported "Saved" -- so the form said yes, the name stayed, and the card
  // header did not move (reported 25 Aug). Silently ignoring an edit is worse
  // than refusing it: the person believes something happened. Refuse, and say
  // why. Everything else on this form may legitimately be blanked.
  if ('first_name' in form && !clean(form.first_name)) {
    return { ok: false, error: 'A first name is needed — this is how staff will know who they are.' };
  }
  if ('last_name' in form && !clean(form.last_name)) {
    return { ok: false, error: 'A last name is needed.' };
  }
  if (!emailLooksValid(form.email)) {
    return { ok: false, error: 'That email address doesn’t look right — please check it.' };
  }

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

// Add a person to this household directly, without going through a
// registration.
//
// Until 24 Aug the ONLY way a person came into existence was by being typed
// into the registration wizard, which put the family's own roster behind an
// event. Asked for in exactly the terms of an airline's saved-traveller list:
// keep the family up to date once, then pick people from it when registering.
// Row-level security has allowed this since 0001 (people_insert is scoped to
// my_household_ids()); only the UI was missing.
export async function addHouseholdPerson(householdId, form) {
  const supabase = await createClient();
  const first = clean(form.first_name);
  const last = clean(form.last_name);
  if (!first || !last) {
    return { ok: false, error: 'Please give a first and last name.' };
  }
  const { data, error } = await supabase
    .from('people')
    .insert({
      household_id: householdId,
      first_name: first,
      last_name: last,
      date_of_birth: clean(form.date_of_birth),
      gender: clean(form.gender),
      phone: clean(form.phone),
      email: clean(form.email),
    })
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/household');
  revalidatePath('/account/dashboard');
  revalidatePath('/register/family');
  return { ok: true, personId: data?.id };
}

// Remove a person from the household -- guarded twice.
//
// A person who appears on ANY registration is part of a record the ministry
// has acted on: a roster was printed, a fee was charged, an agreement was
// signed naming the household. Deleting them would quietly change history, so
// it is refused here and pointed at staff, who can cancel a participant
// properly. Someone who has never registered is just a wrong entry, and
// deleting a wrong entry is exactly right.
export async function removeHouseholdPerson(personId) {
  const supabase = await createClient();

  const { count: partCount, error: partError } = await supabase
    .from('registration_participants')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', personId);
  if (partError) return { ok: false, error: partError.message };
  if ((partCount ?? 0) > 0) {
    return {
      ok: false,
      error:
        'This person is on a registration, so they can’t be removed here. Contact the ministry and staff can cancel their place properly.',
    };
  }

  // The primary contact is pointed at by the household row. Deleting them
  // would silently blank that pointer (ON DELETE SET NULL), leaving a
  // household nobody is responsible for -- so ask for a new contact first.
  const { data: asContact } = await supabase
    .from('households')
    .select('id')
    .eq('primary_contact_person_id', personId)
    .maybeSingle();
  if (asContact) {
    return {
      ok: false,
      error:
        'This person is your primary contact. Choose a different primary contact first, then remove them.',
    };
  }

  // Someone who SIGNED for this household is not removable either (reported
  // 25 Aug: a primary contact who had signed the releases was demoted and then
  // deleted, and the system allowed it). The two guards above both missed it,
  // because a named contact carries no participant row of their own.
  //
  // Deleting them would leave signatures naming a person the household no
  // longer contains -- the roster and the signed record contradicting each
  // other, which is exactly the state you cannot explain later. Matched by
  // name because a household-level signature records the signer's name rather
  // than a person id.
  const { data: person } = await supabase
    .from('people')
    .select('first_name, last_name, household_id')
    .eq('id', personId)
    .maybeSingle();

  if (person) {
    const fullName = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
    if (fullName) {
      const { data: sigs } = await supabase
        .from('agreement_signatures')
        .select('signed_at, signer_name')
        .eq('household_id', person.household_id)
        .ilike('signer_name', fullName);
      if ((sigs ?? []).length > 0) {
        return {
          ok: false,
          error: `${fullName} has signed agreements for your family, so their record has to stay. Contact the ministry if this needs sorting out.`,
        };
      }
    }
  }

  const { error } = await supabase.from('people').delete().eq('id', personId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/household');
  revalidatePath('/account/dashboard');
  revalidatePath('/register/family');
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
