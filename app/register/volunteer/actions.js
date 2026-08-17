'use server';

// Volunteer-application actions for the FAMILY side. Ownership is verified
// explicitly (the participant must belong to a household this login is a
// member of) before any write; row-level security is the backstop, and its
// family-update rule only permits the statuses 'applied' and 'withdrawn' —
// approval happens on the staff side only.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

async function ownParticipant(supabase, userId, participantId) {
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', userId);
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (!householdIds.length) return false;

  const { data: part } = await supabase
    .from('registration_participants')
    .select('id, registrations!inner ( household_id )')
    .eq('id', participantId)
    .in('registrations.household_id', householdIds)
    .maybeSingle();
  return Boolean(part);
}

export async function submitVolunteerApplication(payload) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const supabase = await createClient();
  const participantId = payload?.participantId;
  if (!participantId || !(await ownParticipant(supabase, user.id, participantId))) {
    return { ok: false, error: 'That registration could not be found on your account.' };
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
