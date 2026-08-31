'use server';

// The per-person support profile — the "fuller form" registration promises.
//
// No migration was needed for any of this: person_support and its row-level
// security have existed since 0001. The family policy is "this person is in a
// household I belong to", so a parent can fill in their child's profile and
// nobody else's, and the server action does not have to re-implement that —
// Postgres refuses the write.
//
// One rule shapes the whole form: NOTHING IS REQUIRED. CampSite made these
// fields mandatory free text, and their export is full of "NA" and "N.A." as a
// result — an answer that costs a family time to type and tells staff nothing.
// A blank here is honest, and a yes/no with a follow-up gets a real answer from
// the families who have one.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

// Everything a family may write. Anything not on this list is ignored rather
// than trusted; buddy_ratio and the reviewed_at/reviewed_by columns are staff
// judgements and are deliberately absent.
const TEXT_FIELDS = [
  'disabilities',
  'communication',
  'mobility',
  'personal_care',
  'daily_living_supports',
  'allergy_detail',
  'dietary_needs',
  'medications',
  'seizure_detail',
  'rescue_medication_detail',
  'behaviour_triggers',
  'redirection_strategies',
  'sleep_notes',
  'other_concerns',
  'emergency_contact_name',
  'emergency_contact_phone',
  'emergency_contact_relationship',
];

const FLAG_FIELDS = [
  'has_allergies',
  'has_seizures',
  'has_rescue_medication',
  'has_sleep_disturbance',
  'has_caregiver',
  'buddy_required',
];

export async function savePersonSupport(personId, fields) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please log in and try again.' };
  }
  if (!personId) return { ok: false, error: 'Missing person.' };

  // The dashboard's "Details on file" status reads this stamp and nothing
  // else. It is set here, by the details form, and nowhere else -- the
  // registration wizard used to share columns with this form, and inferring
  // completion from content marked people "done" who had never seen the form.
  const patch = { person_id: personId, details_saved_at: new Date().toISOString() };
  for (const k of TEXT_FIELDS) {
    if (k in (fields || {})) {
      const v = fields[k];
      // An emptied box means "not applicable", which is stored as NULL so it
      // reads back as unanswered rather than as an empty string that looks
      // like a considered blank.
      patch[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
  }
  for (const k of FLAG_FIELDS) {
    if (k in (fields || {})) patch[k] = fields[k] === true || fields[k] === 'true';
  }

  // E33/E42. Handled on its own rather than through TEXT_FIELDS, because it is
  // a constrained value, not prose: the database allows exactly mild, severe
  // and anaphylaxis (0064), so anything else has to become NULL here or the
  // whole save fails on a check constraint and the family loses the form.
  //
  // An empty string means "unset it", which is what tapping the chosen button
  // again does. NULL is a real answer meaning nobody has said — never the same
  // as mild.
  if ('allergy_severity' in (fields || {})) {
    const v = fields.allergy_severity;
    patch.allergy_severity =
      v === 'mild' || v === 'severe' || v === 'anaphylaxis' ? v : null;
  }

  // Turning a flag OFF clears the detail that belonged to it. Leaving a
  // seizure plan behind after a family has said "no seizures" would put stale
  // medical text in front of a nurse at camp, which is worse than no text.
  if (patch.has_allergies === false) {
    patch.allergy_detail = null;
    patch.allergy_severity = null;
  }
  if (patch.has_seizures === false) patch.seizure_detail = null;
  if (patch.has_rescue_medication === false) patch.rescue_medication_detail = null;
  if (patch.has_sleep_disturbance === false) patch.sleep_notes = null;

  const supabase = await createClient();
  const { error } = await supabase
    .from('person_support')
    .upsert(patch, { onConflict: 'person_id' });

  if (error) {
    // The most likely failure is RLS refusing a person outside this family.
    if (/row-level security/i.test(error.message || '')) {
      return { ok: false, error: 'That person is not in your household.' };
    }
    return { ok: false, error: `Could not save: ${error.message}` };
  }

  revalidatePath('/account/dashboard');
  revalidatePath(`/account/details/${personId}`);
  // Staff surfaces that read support details.
  revalidatePath('/admin/medical');
  revalidatePath('/admin/dietary');
  revalidatePath('/admin/checkin');
  return { ok: true };
}
