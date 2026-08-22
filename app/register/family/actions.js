'use server';

// Server action for the family registration wizard.
//
// The whole write now happens in ONE atomic Postgres function,
// public.submit_family_registration (migration 0003): household -> membership ->
// people (+ support) -> registration -> participants, in a single transaction, so a
// half-failed submit rolls back cleanly instead of leaving a partial record. The
// function runs as the family (SECURITY INVOKER), so row-level security still
// applies to every row. It is also idempotent: resubmitting matches existing people
// by name + date of birth and updates them rather than creating duplicates.

import { createClient, getCurrentUser } from '@/lib/supabase/server';

// Wizard's human-readable roles -> the camp_role enum in 0001_core_schema.sql.
const ROLE_MAP = {
  'Camper with disability': 'camper',
  'Parent/Guardian': 'parent_guardian',
  'Sibling': 'sibling',
  'Caregiver': 'caregiver',
  // Volunteers register through the same family flow (a solo volunteer is
  // simply a household of one). The fuller volunteer APPLICATION -- experience,
  // preferred areas, background-check hand-off -- is a separate roadmap item;
  // this makes the fee-carrying registration itself possible today.
  'Volunteer': 'volunteer',
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

  // Keep only members with a real name, and translate the role label to the enum
  // the database stores.
  const mapped = (members || [])
    .filter((m) => (m.firstName || '').trim() && (m.lastName || '').trim())
    .map((m) => ({
      personId: m.personId || null,
      firstName: m.firstName.trim(),
      lastName: m.lastName.trim(),
      dob: m.dob || null,
      sex: m.sex || null,
      role: ROLE_MAP[m.role] || 'camper',
      // Enrollment questions. The selects hold strings, and '' means "not
      // answered" -- which has to reach the database as null, not as a blank,
      // so an answer given last time is never wiped by a skipped dropdown.
      tshirt: m.tshirt || null,
      firstTime: m.firstTime === '' || m.firstTime == null ? null : m.firstTime,
      needs: m.needs || '',
      diet: m.diet || '',
    }));
  if (mapped.length === 0) {
    return {
      ok: false,
      error: 'Please add at least one family member with a first and last name.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_family_registration', {
    payload: { family, members: mapped, eventId, optionId, notes: notes || '' },
  });

  if (error) {
    const msg = error.message || '';
    if (/camp option unavailable/i.test(msg)) {
      return { ok: false, error: 'That camp option is no longer available. Please refresh and try again.' };
    }
    if (/not authenticated/i.test(msg)) {
      return { ok: false, error: 'Your session has expired. Please log in and try again.' };
    }
    return { ok: false, error: `Could not save your registration: ${msg}` };
  }

  return { ok: true, registrationId: data?.registrationId, saved: data?.saved ?? mapped.length };
}
