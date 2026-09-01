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

  const {
    family = {},
    members = [],
    eventId,
    optionId,
    volunteerOptionId = null,
    notes,
    agreements = null,
  } = payload || {};
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
      // E45. Not sent to the RPC — it does not write this column — so it is
      // applied below, beside the volunteer second role, off the same read-back.
      preferredName: (m.preferredName || '').trim(),
      dob: m.dob || null,
      sex: m.sex || null,
      role: ROLE_MAP[m.role] || 'camper',
      // Not sent to the RPC — it takes one option and writes one row per
      // person. The second, zero-fee volunteer row is written below.
      alsoVolunteering: m.alsoVolunteering === true && m.role !== 'Volunteer',
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
      .select('name, deposit_cents')
      .eq('id', eventId)
      .maybeSingle();
    const to = (family.email || '').trim() || user.email;
    if (origin && to && ev?.name) {
      const { subject, html } = registrationConfirmationEmail({
        origin,
        eventName: ev.name,
        saved: data?.saved ?? mapped.length,
        isUpdate: Boolean(payload?.isUpdate),
        // Per PERSON, matching the dashboard (31 Aug). Sending "$50" to a
        // family of two and then showing them $100 on the dashboard is how a
        // family arrives believing they have paid what was asked.
        depositCents: (ev?.deposit_cents ?? 0) * (data?.saved ?? mapped.length),
        depositPerPersonCents: ev?.deposit_cents ?? 0,
      });
      await sendEmail({ to, subject, html });
    }
  } catch (e) {
    console.error('registration confirmation email:', e?.message);
  }

  // The both-weeks discount is a RULE over stored facts, not something this
  // form works out (0070). Re-run it for everyone on this registration: the
  // second week is usually registered weeks after the first, so this is the
  // moment the pair becomes true. Re-running is safe -- the function clears
  // what it previously wrote and re-earns it.
  //
  // Never fatal. A registration that saved must not be reported as failed
  // because a discount could not be recalculated; staff can re-run it, and the
  // family's places are the thing that matters here.
  // SECOND ROLE: a parent (or sibling, or caregiver) who is also volunteering.
  //
  // Written here rather than inside submit_family_registration because that
  // function takes ONE event option and writes one row per person, and it is a
  // hundred and forty lines of money code. Adding a second row from outside
  // needs no change to it at all: the unique is (registration_id, person_id,
  // event_option_id), and RLS lets a family insert into their own registration
  // (registration_id in my_registration_ids()), so this runs under exactly the
  // permissions the rest of the submit does.
  //
  // fee_cents 0 — the person is charged once, on their first role. See 0069
  // and the DECISIONS.md entry: a zero is easier to audit than two numbers that
  // must always cancel.
  //
  // Never fatal. The registration is already saved; a missing second role is a
  // thing staff can add, where a failed submit is a family with no place.
  try {
    const wantVolunteer = new Set(
      mapped
        .filter((m) => m.alsoVolunteering)
        .map((m) => `${m.firstName}|${m.lastName}`.toLowerCase())
    );
    const wantPreferred = new Map(
      mapped
        .filter((m) => m.preferredName)
        .map((m) => [`${m.firstName}|${m.lastName}`.toLowerCase(), m.preferredName])
    );
    const regId2 = data?.registrationId;

    // ONE read-back serving both jobs below. Deliberately NOT nested inside the
    // volunteer branch: preferred names must be written whether or not anybody
    // ticked "also volunteering", and putting this inside that `if` meant they
    // were saved only for families who happened to have a volunteer — caught
    // before it shipped, but it is exactly the shape of bug that hides.
    if (regId2 && (wantVolunteer.size > 0 || wantPreferred.size > 0)) {
      const { data: saved } = await supabase
        .from('registration_participants')
        .select('person_id, event_option_id, people ( first_name, last_name )')
        .eq('registration_id', regId2);

      const already = new Set(
        (saved ?? [])
          .filter((r) => r.event_option_id === volunteerOptionId)
          .map((r) => r.person_id)
      );

      // E45, preferred names, off the SAME read-back. The RPC does not write
      // people.preferred_name, and adding it there would mean reopening a
      // hundred and forty lines of money code for a display field.
      if (wantPreferred.size > 0) {
        const seen = new Set();
        for (const r of saved ?? []) {
          const key = `${r.people?.first_name ?? ''}|${r.people?.last_name ?? ''}`.toLowerCase();
          const want = wantPreferred.get(key);
          if (!want || !r.person_id || seen.has(r.person_id)) continue;
          seen.add(r.person_id);
          const { error: prefError } = await supabase
            .from('people')
            .update({ preferred_name: want })
            .eq('id', r.person_id);
          if (prefError) console.error('preferred name:', prefError.message);
        }
      }

      const rows = (!volunteerOptionId || wantVolunteer.size === 0 ? [] : (saved ?? []))
        .filter((r) => {
          const key = `${r.people?.first_name ?? ''}|${r.people?.last_name ?? ''}`.toLowerCase();
          return wantVolunteer.has(key) && !already.has(r.person_id);
        })
        // A person can appear twice in `saved` once this has run before; keep one.
        .filter((r, i, arr) => arr.findIndex((x) => x.person_id === r.person_id) === i)
        .map((r) => ({
          registration_id: regId2,
          person_id: r.person_id,
          event_option_id: volunteerOptionId,
          camp_role: 'volunteer',
          status: 'submitted',
          fee_cents: 0,
          submitted_at: new Date().toISOString(),
          furthest_step: 5,
        }));

      if (rows.length > 0) {
        const { error: volError } = await supabase
          .from('registration_participants')
          .insert(rows);
        if (volError) console.error('second volunteer role:', volError.message);
      }
    }
  } catch (e) {
    console.error('second volunteer role:', e?.message);
  }

  try {
    // Read the people back off the saved registration rather than trusting the
    // payload: a person registering for the first time has NO personId going in
    // — the RPC creates them — so using mapped[].personId would skip exactly
    // the family this is most likely to be wrong for.
    const regId = data?.registrationId;
    if (regId) {
      const { data: savedParts } = await supabase
        .from('registration_participants')
        .select('person_id')
        .eq('registration_id', regId);
      const ids = [...new Set((savedParts ?? []).map((r) => r.person_id).filter(Boolean))];
      await Promise.all(
        ids.map((id) => supabase.rpc('recalc_multi_week_discount', { p_person_id: id }))
      );
    }
  } catch (e) {
    console.error('multi-week discount recalc:', e?.message);
  }

  // Whether the deposit is still outstanding, so the success card asks for it
  // only when it is genuinely unpaid. The panel used to be hidden on any
  // update, which meant editing an unpaid registration silently dropped the
  // one thing we most need the family to do (reported 25 Aug). "Update" and
  // "already paid" are different facts. A failure here leaves this undefined
  // and the card errs toward asking, which is the safe direction.
  let depositDue;
  try {
    const regId = data?.registrationId;
    if (regId) {
      const [{ data: bal }, { data: ev2 }] = await Promise.all([
        supabase
          .from('registration_balances')
          .select('paid_cents, balance_cents')
          .eq('registration_id', regId)
          .maybeSingle(),
        supabase.from('events').select('deposit_cents').eq('id', eventId).maybeSingle(),
      ]);
      const deposit = ev2?.deposit_cents ?? 0;
      depositDue =
        deposit > 0 && (bal?.paid_cents ?? 0) === 0 && (bal?.balance_cents ?? 0) > 0;
    }
  } catch (e) {
    console.error('deposit-due check:', e?.message);
  }

  return {
    ok: true,
    registrationId: data?.registrationId,
    saved: data?.saved ?? mapped.length,
    signed: data?.signed ?? 0,
    depositDue,
  };
}
