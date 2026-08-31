'use server';

// The assignment portal's writes: placing people into programs, and saying
// who leads one.
//
// PERMISSION NOTE, and the reason this file checks rather than assumes.
// Writing `registration_participants.program_id` goes through that table's
// existing UPDATE policy, which is `is_registrar()` -- registrar or admin, NOT
// coordinator. A coordinator pressing Save would get zero rows updated and no
// error, because an UPDATE that matches nothing is not a failure in Postgres.
// That is the silent-failure shape this project has been bitten by twice
// (0054, and the Checkr importer). So the check is explicit and the message
// says what to do about it.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

async function requireRegistrar() {
  const staff = await getStaff();
  if (!staff) return { error: 'You are not signed in as staff.' };
  if (!can(staff, 'registrar')) {
    return {
      error:
        'Placing people into programs needs registrar or administrator access. Ask an administrator.',
    };
  }
  return { staff };
}

// One person, one program. Passing programId as null clears the placement --
// used by the "Unassign" option, and the reason program_id is nullable.
export async function setParticipantProgram({ participantId, programId }) {
  if (!participantId) return { ok: false, error: 'Nothing to place.' };
  const { error: permError } = await requireRegistrar();
  if (permError) return { ok: false, error: permError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('registration_participants')
    .update({ program_id: programId || null })
    .eq('id', participantId)
    .select('id');

  if (error) {
    console.error('setParticipantProgram:', error.message);
    return { ok: false, error: 'That placement could not be saved.' };
  }
  // Belt and braces against the silent case above: no rows back means the
  // policy refused, and the person deserves to be told rather than shown a
  // page that quietly did not change.
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was saved — you may not have permission to change this.' };
  }

  revalidatePath('/admin/programs');
  revalidatePath('/admin/my-program');
  revalidatePath('/admin/rosters');
  return { ok: true };
}

// Several at once, because placing a whole cabin of eight-year-olds into
// Children one dropdown at a time is how a screen stops being used.
export async function setManyParticipantPrograms({ participantIds, programId }) {
  const ids = (participantIds ?? []).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Nobody selected.' };
  const { error: permError } = await requireRegistrar();
  if (permError) return { ok: false, error: permError };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('registration_participants')
    .update({ program_id: programId || null })
    .in('id', ids)
    .select('id');

  if (error) {
    console.error('setManyParticipantPrograms:', error.message);
    return { ok: false, error: 'Those placements could not be saved.' };
  }
  const saved = data?.length ?? 0;
  if (saved === 0) {
    return { ok: false, error: 'Nothing was saved — you may not have permission to change these.' };
  }

  revalidatePath('/admin/programs');
  revalidatePath('/admin/my-program');
  revalidatePath('/admin/rosters');
  // Reported honestly rather than as a flat "done": if eight were selected and
  // six saved, the person needs to know before they walk away.
  return { ok: true, saved, requested: ids.length };
}

// --- Who leads a program ---------------------------------------------------
// Granting leadership is a real access decision -- it lets somebody who is not
// staff into part of the staff area -- so it is administrator-only, it records
// who granted it, and revoking sets active = false rather than deleting the
// row. Who could see which children's names, and when, should still be
// answerable next year.
export async function grantProgramLeader({ email, programId, eventId }) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) {
    return { ok: false, error: 'Only an administrator can name a program leader.' };
  }
  const clean = (email ?? '').trim().toLowerCase();
  if (!clean || !programId || !eventId) {
    return { ok: false, error: 'Give an email address, a program and an event.' };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

  // The person must already have an account. Deliberately: this grants access
  // to children's names, and "create an account for them" is how a grant ends
  // up on an address nobody checked.
  //
  // Email lives in auth.users, which a client may not read, so this goes
  // through the same admin-only lookup the Staff page uses (migration 0011).
  // It returns zero rows for anyone who is not an admin, which makes the RPC
  // itself the second lock behind the can(staff,'admin') check above.
  const { data: found, error: lookupError } = await supabase.rpc('staff_lookup_by_email', {
    p_email: clean,
  });

  if (lookupError) {
    console.error('grantProgramLeader lookup:', lookupError.message);
    return { ok: false, error: 'Could not look that address up.' };
  }
  const profile = found?.[0]
    ? { id: found[0].profile_id, first_name: found[0].first_name, last_name: found[0].last_name }
    : null;
  if (!profile) {
    return {
      ok: false,
      error:
        'No account with that address. Ask them to create one first, then name them here — this grant lets someone see campers’ names, so it is never made against an address that has not been used.',
    };
  }

  // MUST BE REGISTERED FOR THIS EVENT. Added 31 Aug 2026 after a leader was
  // named for Camp Celebrate 2027 Week 1 who was only registered for the Adult
  // Adventure Retreat — a different camp, in a different year.
  //
  // The only checks before this were "the caller is an admin" and "the address
  // has an account". An account is not a registration: any family member who
  // had ever signed up for anything could be handed a list of children's names
  // for a week they have nothing to do with.
  //
  // people.profile_id is the link from a login to the person themselves.
  const { data: mePeople } = await supabase
    .from('people')
    .select('id')
    .eq('profile_id', profile.id);
  const myPersonIds = (mePeople ?? []).map((r) => r.id);

  let myRoles = [];
  if (myPersonIds.length) {
    const { data: parts } = await supabase
      .from('registration_participants')
      .select('camp_role, status, registrations!inner ( event_id )')
      .in('person_id', myPersonIds)
      .eq('registrations.event_id', eventId)
      .neq('status', 'cancelled');
    myRoles = (parts ?? []).map((r) => r.camp_role);
  }

  if (myRoles.length === 0) {
    return {
      ok: false,
      error:
        `${profile.first_name ?? 'That person'} is not registered for this event. ` +
        'A program leader sees the names and support flags of the children in their ' +
        'program, so the grant is only ever made to somebody who is coming to that ' +
        'same camp. Ask them to register first.',
    };
  }

  // Registered, but not as a volunteer. Allowed — a parent who also serves is
  // real, if uncommon — but said out loud, because the volunteer application is
  // what carries the background check and the Creed affirmation, and those are
  // exactly the things a leader is trusted on. Warned, not blocked: the person
  // deciding is an administrator who can see the whole picture.
  const isVolunteer = myRoles.includes('volunteer');

  const { error } = await supabase.from('program_leaders').upsert(
    {
      profile_id: profile.id,
      program_id: programId,
      event_id: eventId,
      granted_by: user?.id ?? null,
      granted_at: new Date().toISOString(),
      active: true,
    },
    { onConflict: 'profile_id,program_id,event_id' }
  );

  if (error) {
    console.error('grantProgramLeader:', error.message);
    return { ok: false, error: 'That leader could not be saved.' };
  }

  revalidatePath('/admin/programs');
  return {
    ok: true,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || clean,
    // Shown beside the confirmation, not instead of it. The grant is made.
    warning: isVolunteer
      ? null
      : 'They are registered for this event, but not as a volunteer — so they have not ' +
        'filed a volunteer application, which is what carries the background check and the ' +
        'Apostles’ Creed affirmation. Ask them to register as a volunteer as well.',
  };
}

export async function revokeProgramLeader({ grantId }) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) {
    return { ok: false, error: 'Only an administrator can remove a program leader.' };
  }
  if (!grantId) return { ok: false, error: 'Nothing to remove.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('program_leaders')
    .update({ active: false })
    .eq('id', grantId);

  if (error) {
    console.error('revokeProgramLeader:', error.message);
    return { ok: false, error: 'That could not be removed.' };
  }

  revalidatePath('/admin/programs');
  return { ok: true };
}
