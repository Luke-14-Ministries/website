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

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail, registrationConfirmationEmail } from '@/lib/email';

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

  const { family = {}, members = [], eventId, optionId, notes, agreements = null } = payload || {};
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
      // Permissions. Unanswered stays null on purpose: silence is neither a
      // grant nor a refusal, and recording it as "no" would misrepresent a
      // family that simply skipped the question.
      mediaConsent: m.mediaConsent === '' || m.mediaConsent == null ? null : m.mediaConsent,
      directoryConsent:
        m.directoryConsent === '' || m.directoryConsent == null ? null : m.directoryConsent,
      // No needs/diet here any more (removed 24 Aug): the wizard asks no
      // medical questions, and the RPC's coalesce guards mean absent keys
      // never touch what the details form has saved.
    }));
  if (mapped.length === 0) {
    return {
      ok: false,
      error: 'Please add at least one family member with a first and last name.',
    };
  }

  // The signature block is only sent when this household has not already
  // signed for this registration; the RPC also refuses to overwrite an
  // existing signature, so a tampered payload cannot rewrite the date on a
  // release either.
  // The same signer-name rule the form enforces, re-checked here because the
  // form is not a boundary: the signature must name the primary contact.
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    agreements &&
    (agreements.signerName || '').trim() &&
    norm(agreements.signerName) !== norm(`${family.contactFirst} ${family.contactLast}`)
  ) {
    return {
      ok: false,
      error: "The signature must match the primary contact's name.",
    };
  }

  const signature =
    agreements && (agreements.signerName || '').trim() && Array.isArray(agreements.keys)
      ? {
          signerName: agreements.signerName.trim(),
          signerRole: agreements.signerRole || 'account_holder',
          keys: agreements.keys,
        }
      : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_family_registration', {
    payload: {
      family,
      members: mapped,
      eventId,
      optionId,
      notes: notes || '',
      ...(signature ? { agreements: signature } : {}),
    },
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

  // THE SAVE SUCCEEDED -- now throw away every cached copy of a page that
  // just became wrong.
  //
  // Reported 24 Aug: a family finished registering, clicked "Go to My
  // Dashboard", and landed on "You haven't registered anyone yet" with an
  // empty household. A refresh fixed it. That is Next's CLIENT router cache:
  // the dashboard had been visited before the registration, its payload was
  // held for reuse, and a <Link> navigation is entitled to serve that copy
  // rather than ask the server again. Nothing was lost -- the page was simply
  // a minute out of date, which is exactly what it is designed to do and
  // exactly wrong here.
  //
  // revalidatePath inside a server action clears BOTH the server cache and
  // the client's router cache for the path, so the next navigation fetches
  // fresh. The registration action never called it (the details form did,
  // which is why that one always looked right).
  for (const p of [
    '/account/dashboard',
    '/account/household',
    '/register/family',
    '/admin/rosters',
    '/admin/registrations',
    '/admin/changes',
    '/admin/checkin',
  ]) {
    revalidatePath(p);
  }

  // Confirmation email -- a courtesy attached to a save that already
  // succeeded, so any failure here is logged inside sendEmail and swallowed.
  // The site sent NOTHING on submit until 24 Aug; the CampSite system
  // families are used to always confirmed, and silence after a submit reads
  // as doubt. Recipient preference: the email typed on the form (it may
  // deliberately differ from the login), falling back to the login.
  try {
    const hdrs = await headers();
    const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
    const proto = hdrs.get('x-forwarded-proto') ?? 'https';
    const origin = host ? `${proto}://${host}` : '';
    const { data: ev } = await supabase
      .from('events')
      .select('name')
      .eq('id', eventId)
      .maybeSingle();
    const to = (family.email || '').trim() || user.email;
    if (origin && to && ev?.name) {
      const { subject, html } = registrationConfirmationEmail({
        origin,
        eventName: ev.name,
        saved: data?.saved ?? mapped.length,
        isUpdate: Boolean(payload?.isUpdate),
      });
      await sendEmail({ to, subject, html });
    }
  } catch (e) {
    console.error('registration confirmation email:', e?.message);
  }

  return {
    ok: true,
    registrationId: data?.registrationId,
    saved: data?.saved ?? mapped.length,
    signed: data?.signed ?? 0,
  };
}
