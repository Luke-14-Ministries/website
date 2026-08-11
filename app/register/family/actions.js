'use server';

// Server action for the family registration wizard.
//
// Runs on the server, authenticated as the logged-in family via their session
// cookie, so every write below is also checked by row-level security in the
// database -- defence in depth. The browser never talks to the tables directly.
//
// Shape of the write, in order (this order matters for RLS: a person/registration
// can only be inserted once the login is a member of the household):
//   household  ->  household_members (owner)  ->  people (+ person_support)
//   ->  registration (one per household per event)  ->  registration_participants
//
// IDs are generated here and inserted explicitly rather than read back with
// RETURNING. That is deliberate: immediately after inserting a household, the
// login is not yet a member of it, so a RETURNING select would be filtered out
// by the household read policy and come back empty. Generating the id sidesteps
// that entirely.

import { createClient, getCurrentUser } from '@/lib/supabase/server';

// Wizard's human-readable roles -> the camp_role enum in 0001_core_schema.sql.
const ROLE_MAP = {
  'Camper with disability': 'camper',
  'Parent/Guardian': 'parent_guardian',
  'Sibling': 'sibling',
  'Caregiver': 'caregiver',
};

export async function submitFamilyRegistration(payload) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please log in and try again.' };
  }

  const { family = {}, members = [], eventId, optionId, notes } = payload || {};

  if (!eventId || !optionId) {
    return { ok: false, error: 'Please choose a camp week before submitting.' };
  }
  const valid = members.filter(
    (m) => (m.firstName || '').trim() && (m.lastName || '').trim()
  );
  if (valid.length === 0) {
    return { ok: false, error: 'Please add at least one family member with a first and last name.' };
  }

  const supabase = await createClient();

  // Take the fee from the option on the server. Never trust a price sent from the
  // browser -- fee_cents is snapshotted onto each participant at this moment, so a
  // later price change will not disturb this family.
  const { data: opt, error: optErr } = await supabase
    .from('event_options')
    .select('fee_cents, event_id')
    .eq('id', optionId)
    .single();
  if (optErr || !opt || opt.event_id !== eventId) {
    return { ok: false, error: 'That camp option is no longer available. Please refresh and try again.' };
  }
  const feeCents = opt.fee_cents ?? 0;

  // 1. Reuse the login's household if it already has one, otherwise create it
  //    and make this login the owner.
  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle();

  let householdId = membership?.household_id;

  const displayName =
    `${family.contactFirst || ''} ${family.contactLast || ''}`.trim() || 'Family';

  if (!householdId) {
    householdId = crypto.randomUUID();
    const { error: hhErr } = await supabase.from('households').insert({
      id: householdId,
      display_name: displayName,
      email: family.email || user.email || null,
      phone: family.phone || null,
      address_line1: family.address || null,
      home_church: family.church || null,
    });
    if (hhErr) return { ok: false, error: `Could not create your household: ${hhErr.message}` };

    const { error: memErr } = await supabase
      .from('household_members')
      .insert({ household_id: householdId, profile_id: user.id, role: 'owner' });
    if (memErr) return { ok: false, error: `Could not link you to your household: ${memErr.message}` };
  } else {
    // Keep contact details current, but never blank out a field the family left empty.
    await supabase
      .from('households')
      .update({
        display_name: displayName || undefined,
        email: family.email || undefined,
        phone: family.phone || undefined,
        address_line1: family.address || undefined,
        home_church: family.church || undefined,
      })
      .eq('id', householdId);
  }

  // 2. One registration per household per event. Reuse it if the family is
  //    coming back to a registration they already started.
  let registrationId;
  const { data: existing } = await supabase
    .from('registrations')
    .select('id')
    .eq('household_id', householdId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing) {
    registrationId = existing.id;
    await supabase
      .from('registrations')
      .update({ family_notes: notes || null })
      .eq('id', registrationId);
  } else {
    registrationId = crypto.randomUUID();
    const { error: regErr } = await supabase.from('registrations').insert({
      id: registrationId,
      household_id: householdId,
      event_id: eventId,
      family_notes: notes || null,
    });
    if (regErr) return { ok: false, error: `Could not start your registration: ${regErr.message}` };
  }

  // 3. Each family member becomes a person (+ their support needs) and a
  //    participant row carrying their role, status and snapshotted fee.
  //
  // NOTE (known MVP limitation): submitting twice creates a second set of people
  // rather than updating the first. Fine for the preview; real de-duplication on
  // resubmit is a follow-up, and belongs with the "save as you go" work.
  const nowIso = new Date().toISOString();
  let saved = 0;

  for (const m of valid) {
    const personId = crypto.randomUUID();

    const { error: pErr } = await supabase.from('people').insert({
      id: personId,
      household_id: householdId,
      first_name: m.firstName.trim(),
      last_name: m.lastName.trim(),
      date_of_birth: m.dob || null,
    });
    if (pErr) return { ok: false, error: `Could not save ${m.firstName}: ${pErr.message}` };

    const needs = (m.needs || '').trim();
    const diet = (m.diet || '').trim();
    if (needs || diet) {
      // person_support is the sensitive tier; RLS keeps it readable only by the
      // family and staff holding the sensitive grant.
      await supabase.from('person_support').insert({
        person_id: personId,
        disabilities: needs || null,
        dietary_needs: diet || null,
      });
    }

    const { error: rpErr } = await supabase.from('registration_participants').insert({
      registration_id: registrationId,
      person_id: personId,
      event_option_id: optionId,
      camp_role: ROLE_MAP[m.role] || 'camper',
      status: 'submitted', // a request; staff confirm it, exactly as today
      submitted_at: nowIso,
      fee_cents: feeCents,
      furthest_step: 5,
    });
    if (rpErr) return { ok: false, error: `Could not register ${m.firstName}: ${rpErr.message}` };

    saved += 1;
  }

  return { ok: true, registrationId, saved };
}
