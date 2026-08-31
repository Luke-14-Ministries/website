'use server';

// Volunteer-application actions for the FAMILY side. Ownership is verified
// explicitly (the participant must belong to a household this login is a
// member of) before any write; row-level security is the backstop, and its
// family-update rule only permits the statuses 'applied' and 'withdrawn' —
// approval happens on the staff side only.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

// Returns the participant's ids when this login owns it, or null. It used to
// return a boolean; the Creed signature needs person_id and registration_id,
// and re-querying for them would be a second chance to get the ownership check
// wrong. One lookup, one answer.
async function ownParticipant(supabase, userId, participantId) {
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', userId);
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (!householdIds.length) return null;

  const { data: part } = await supabase
    .from('registration_participants')
    .select('id, person_id, registration_id, registrations!inner ( household_id )')
    .eq('id', participantId)
    .in('registrations.household_id', householdIds)
    .maybeSingle();
  return part ? { personId: part.person_id, registrationId: part.registration_id } : null;
}

export async function submitVolunteerApplication(payload) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const supabase = await createClient();
  const participantId = payload?.participantId;
  const owned = participantId ? await ownParticipant(supabase, user.id, participantId) : null;
  if (!owned) {
    return { ok: false, error: 'That registration could not be found on your account.' };
  }

  // The Apostles' Creed affirmation (migration 0062, item L2). Required of
  // volunteers, never of families or campers -- which is why it is looked up
  // by key here rather than through agreement_requirements.
  //
  // Checked on the SERVER as well as in the form. The form's check is a
  // courtesy that names the problem early; this one is the one that holds,
  // because a server action is a public endpoint whatever page fronts it.
  const { data: creedRows } = await supabase
    .from('agreements')
    .select('id, version')
    .eq('key', 'apostles_creed')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1);
  const creed = creedRows?.[0] ?? null;

  if (creed && payload?.creedAffirmed !== true) {
    // Unless they have already affirmed this exact version, in which case the
    // form arrives pre-ticked and an edit to the skills box should not demand
    // a fresh affirmation of something already on record.
    const { data: already } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('agreement_id', creed.id)
      .eq('person_id', owned.personId)
      .limit(1);
    if (!already?.length) {
      return {
        ok: false,
        error:
          'Please read and affirm the Apostles’ Creed — it is required of everyone serving at camp.',
      };
    }
  }

  const clean = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

  const { error } = await supabase.from('volunteer_applications').upsert(
    {
      registration_participant_id: participantId,
      first_time_volunteering: typeof payload.firstTime === 'boolean' ? payload.firstTime : null,
      preferred_areas: clean(payload.preferredAreas, 500),
      church_attendance: clean(payload.church, 300),
      faith_statement: clean(payload.faith),
      relevant_skills: clean(payload.skills),
      disability_experience: clean(payload.experience),
      accompanying_adult_person_id: payload.accompanyingAdultId || null,
      // Any family save (first or edit) goes back under review.
      status: 'applied',
      reviewed_by: null,
      reviewed_at: null,
    },
    { onConflict: 'registration_participant_id' }
  );

  if (error) {
    console.error('submitVolunteerApplication:', error.message);
    return { ok: false, error: 'The application could not be saved. Please try again.' };
  }

  // Record the affirmation against the VERSION that was on screen, so "what
  // words did this person affirm, and when" stays answerable after a rewording.
  // Insert-once: re-saving the application must not stack duplicate signatures,
  // and the original date is the true one.
  //
  // Deliberately after the upsert and deliberately not fatal. The application
  // is saved by this point; failing the whole submit because a signature row
  // did not write would lose a filled-in form and tell a volunteer to start
  // again. It is logged loudly instead, and staff review every application
  // anyway.
  if (creed && owned.personId && payload?.creedAffirmed === true) {
    const { data: already } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('agreement_id', creed.id)
      .eq('person_id', owned.personId)
      .limit(1);

    if (!already?.length) {
      const { error: sigError } = await supabase.from('agreement_signatures').insert({
        agreement_id: creed.id,
        person_id: owned.personId,
        registration_id: owned.registrationId ?? null,
        status: 'signed_here',
        signer_role: 'self',
      });
      if (sigError) {
        console.error('creed signature not recorded:', sigError.message);
      }
    }
  }

  revalidatePath('/register/volunteer');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

export async function withdrawVolunteerApplication(participantId) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const supabase = await createClient();
  if (!participantId || !(await ownParticipant(supabase, user.id, participantId))) {
    return { ok: false, error: 'That registration could not be found on your account.' };
  }


  const { error } = await supabase
    .from('volunteer_applications')
    .update({ status: 'withdrawn' })
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('withdrawVolunteerApplication:', error.message);
    return { ok: false, error: 'The application could not be withdrawn. Please try again.' };
  }

  revalidatePath('/register/volunteer');
  revalidatePath('/account/dashboard');
  return { ok: true };
}
