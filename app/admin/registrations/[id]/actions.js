'use server';

// Server actions for the staff registration-management screen.
//
// Every action re-checks that the caller is a registrar (or admin) before it
// touches anything. That check is a courtesy that yields a friendly message --
// it is NOT the security boundary. The real boundary is row-level security in
// 0001_core_schema.sql: the registrar grants on people, households,
// registrations and registration_participants are what actually permit these
// writes, and a non-registrar's request is refused by Postgres even if this
// guard were removed. Each action runs as the signed-in user (the request-scoped
// client), so RLS applies to it exactly as it would to a family editing their
// own record.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const STATUSES = ['draft', 'submitted', 'waitlisted', 'confirmed', 'cancelled'];
const CAMP_ROLES = [
  'camper',
  'parent_guardian',
  'sibling',
  'caregiver',
  'volunteer',
  'childcare',
  'support_team',
];

// Fields a staff member may edit on a person and on a household. Anything not
// on these lists is ignored rather than trusted -- the client cannot widen the
// write surface by sending extra keys.
const PERSON_FIELDS = [
  'first_name',
  'last_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'pronouns',
  'email',
  'phone',
];
const HOUSEHOLD_FIELDS = [
  'display_name',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
];

// Empty strings from a form become NULL in the database, so a cleared field
// reads back as "not provided" rather than as an empty value that looks set.
function clean(fields, allowed) {
  const out = {};
  for (const k of allowed) {
    if (k in fields) {
      const v = fields[k];
      out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
  }
  return out;
}

async function requireRegistrar() {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return { staff: null, error: 'You do not have permission to change registrations.' };
  }
  return { staff, error: null };
}

// After any write, refresh the screens that show this data. The detail page is
// the one being edited; the overview and rosters show counts and status chips
// that just changed.
function revalidateAll(registrationId) {
  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath('/admin');
  revalidatePath('/admin/rosters');
}

// #14 -- move a participant off "submitted / pending review" (or anywhere else).
export async function setParticipantStatus(registrationId, participantId, status) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };

  const now = new Date().toISOString();
  const patch = { status };
  // Stamp the moment of the transition. These are lifecycle markers only --
  // whether money has arrived is answered by the payments table, never here.
  if (status === 'submitted') patch.submitted_at = now;
  if (status === 'confirmed') patch.confirmed_at = now;
  if (status === 'cancelled') patch.cancelled_at = now;

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_participants')
    .update(patch)
    .eq('id', participantId);

  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- edit a camper's own details.
export async function updatePerson(registrationId, personId, fields) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = clean(fields || {}, PERSON_FIELDS);
  if (!patch.first_name && 'first_name' in patch) {
    return { ok: false, error: 'A first name is required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- edit the family's contact details.
export async function updateHousehold(registrationId, householdId, fields) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = clean(fields || {}, HOUSEHOLD_FIELDS);
  const supabase = await createClient();
  const { error } = await supabase.from('households').update(patch).eq('id', householdId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- add a person to this registration by hand. Creates the person in the
// family's household and a participant row for them on the chosen camp option.
export async function addParticipant(registrationId, input) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const first = (input?.first_name || '').trim();
  const last = (input?.last_name || '').trim();
  const optionId = input?.event_option_id;
  const role = CAMP_ROLES.includes(input?.camp_role) ? input.camp_role : 'camper';
  if (!first || !last) return { ok: false, error: 'A first and last name are required.' };
  if (!optionId) return { ok: false, error: 'Please choose which camp option to add them to.' };

  const supabase = await createClient();

  // The household to attach the new person to, read from the registration.
  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select('household_id')
    .eq('id', registrationId)
    .maybeSingle();
  if (regError) return { ok: false, error: regError.message };
  if (!reg) return { ok: false, error: 'Registration not found.' };

  // The fee is copied from the option at the moment of adding, honouring an
  // in-date early-bird price -- the same rule the family wizard follows.
  const { data: opt, error: optError } = await supabase
    .from('event_options')
    .select('fee_cents, early_bird_fee_cents, early_bird_ends_on')
    .eq('id', optionId)
    .maybeSingle();
  if (optError) return { ok: false, error: optError.message };
  if (!opt) return { ok: false, error: 'That camp option no longer exists.' };

  const today = new Date().toISOString().slice(0, 10);
  const fee =
    opt.early_bird_fee_cents != null &&
    opt.early_bird_ends_on &&
    today <= opt.early_bird_ends_on
      ? opt.early_bird_fee_cents
      : opt.fee_cents;

  // Staff can SELECT any person (people_select allows is_staff), so the insert
  // may safely return the new id -- the RETURNING-under-RLS pitfall that bites
  // a family creating their first household does not apply here.
  const { data: person, error: personError } = await supabase
    .from('people')
    .insert({
      household_id: reg.household_id,
      first_name: first,
      last_name: last,
      date_of_birth: input?.date_of_birth ? input.date_of_birth : null,
      gender: (input?.gender || '').trim() || null,
    })
    .select('id')
    .single();
  if (personError) return { ok: false, error: personError.message };

  const { error: partError } = await supabase.from('registration_participants').insert({
    registration_id: registrationId,
    person_id: person.id,
    event_option_id: optionId,
    camp_role: role,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    fee_cents: fee,
  });
  if (partError) return { ok: false, error: partError.message };

  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- permanently delete a participant. Deliberately a two-step safety net:
// the everyday "remove from week" is a reversible status change to 'cancelled'
// (setParticipantStatus above), and ONLY a participant already cancelled can be
// hard-deleted here. So a single misclick can never wipe a real registration --
// you cancel first (undoable), and deleting is a separate, deliberate second
// action. Even then it removes only this week's entry, never the person's
// household record.
export async function deleteParticipantPermanently(registrationId, participantId) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('registration_participants')
    .select('status')
    .eq('id', participantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: 'That entry no longer exists.' };
  if (row.status !== 'cancelled') {
    return {
      ok: false,
      error: 'Cancel this person first (which is reversible), then you can permanently delete them.',
    };
  }

  const { error } = await supabase
    .from('registration_participants')
    .delete()
    .eq('id', participantId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// Scholarships & fee adjustments. The amounts live on the participant row
// (registration_participants.scholarship_cents / discount_cents) -- that is
// what the registration_balances view subtracts, so granting here flows into
// every balance, statement, and the family's dashboard automatically. A
// scholarships row is kept alongside as the audit trail (who granted what,
// when, and the note).
export async function setAdjustments(registrationId, participantId, input) {
  const { staff, error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const toCents = (v) => {
    const n = Number.parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  };
  const scholarship = toCents(input?.scholarship);
  const discount = toCents(input?.discount);
  const note = String(input?.note ?? '').trim();
  if (scholarship < 0 || discount < 0) {
    return { ok: false, error: 'Amounts cannot be negative.' };
  }

  const supabase = await createClient();

  const { data: part, error: readError } = await supabase
    .from('registration_participants')
    .select('id, fee_cents')
    .eq('id', participantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!part) return { ok: false, error: 'That participant no longer exists.' };
  if (scholarship + discount > (part.fee_cents ?? 0)) {
    return {
      ok: false,
      error: 'Scholarship plus discount cannot exceed the fee for this person.',
    };
  }

  const { error } = await supabase
    .from('registration_participants')
    .update({ scholarship_cents: scholarship, discount_cents: discount })
    .eq('id', participantId);
  if (error) return { ok: false, error: error.message };

  // Audit trail in the scholarships table (one row per participant).
  const { data: existing } = await supabase
    .from('scholarships')
    .select('id')
    .eq('registration_participant_id', participantId)
    .maybeSingle();
  const auditRow = {
    registration_participant_id: participantId,
    granted_cents: scholarship,
    status: scholarship > 0 ? 'granted' : 'withdrawn',
    family_statement: note || null,
    reviewed_by: staff.userId,
    reviewed_at: new Date().toISOString(),
  };
  // Never swallow these errors: a refused audit write is how the
  // "who granted this" record silently stayed empty until 0020.
  const { error: auditError } = existing
    ? await supabase.from('scholarships').update(auditRow).eq('id', existing.id)
    : scholarship > 0
      ? await supabase.from('scholarships').insert(auditRow)
      : { error: null };
  if (auditError) {
    return {
      ok: false,
      error: `The amounts saved, but the grant record did not: ${auditError.message}`,
    };
  }

  revalidateAll(registrationId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notes TO the family (registration_family_messages, 0019): short messages
// shown on the family's dashboard — "We added a $100 scholarship credit to
// your registration on 8/17." Registrar-gated here; RLS is the boundary.

export async function addFamilyMessage(registrationId, body) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  const text = typeof body === 'string' ? body.trim().slice(0, 1000) : '';
  if (!text) return { ok: false, error: 'Write the note first.' };

  const supabase = await createClient();
  const { error } = await supabase.from('registration_family_messages').insert({
    registration_id: registrationId,
    body: text,
    created_by: staff.userId,
  });
  if (error) {
    console.error('addFamilyMessage:', error.message);
    return { ok: false, error: 'The note could not be saved.' };
  }
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

export async function deleteFamilyMessage(registrationId, messageId) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_family_messages')
    .delete()
    .eq('id', messageId)
    .eq('registration_id', registrationId);
  if (error) {
    console.error('deleteFamilyMessage:', error.message);
    return { ok: false, error: 'The note could not be removed.' };
  }
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}
