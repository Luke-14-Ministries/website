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
import { getStripe } from '@/lib/stripe/server';
import { registrationDepositCents } from '@/lib/payments';

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
  'home_church',
  // Asked once at registration and never again, so when it is wrong or blank
  // this page is the only way to correct it.
  'how_did_you_hear',
  'how_did_you_hear_from',
];

// The nine sizes the registration form offers. A staff member correcting a
// size over the phone must not be able to invent a tenth.
const TSHIRT_SIZES = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
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
  // Check-In now carries the photo preference, so a permission recorded here
  // has to reach the door immediately -- a stale cache is the one way this
  // change could be made and still not honoured.
  revalidatePath('/admin/checkin');
}

// #14 -- move a participant off "submitted / pending review" (or anywhere else).
export async function setParticipantStatus(
  registrationId,
  participantId,
  status,
  options = {}
) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };

  // CONFIRMED MEANS THE PLACE IS HELD, AND A PLACE IS HELD BY A DEPOSIT.
  //
  // Asked for 31 Aug 2026. Nothing checked before: a registrar could confirm a
  // family who had paid nothing, and the deposit banner would keep asking them
  // for money against a registration already marked confirmed.
  //
  // Two things stop this being a trap. A registration reduced to zero by a
  // scholarship or discount owes no deposit -- registrationDepositCents caps at
  // the balance -- so the fully-funded family sails through without anybody
  // thinking about it. And a registrar who genuinely needs to confirm anyway
  // (a cheque in the post, a board decision) can, by confirming a second time:
  // this returns needsOverride rather than a flat no. A hard block that staff
  // cannot get past is worked around by recording a payment that did not
  // happen, which is worse than the thing it prevents.
  if (status === 'confirmed' && options.override !== true) {
    const supabaseCheck = await createClient();
    const [{ data: reg }, { data: bal }] = await Promise.all([
      supabaseCheck
        .from('registrations')
        .select('id, events ( deposit_cents ), registration_participants ( id, status )')
        .eq('id', registrationId)
        .maybeSingle(),
      supabaseCheck
        .from('registration_balances')
        .select('paid_cents, balance_cents')
        .eq('registration_id', registrationId)
        .maybeSingle(),
    ]);

    const due = registrationDepositCents({
      perPersonCents: reg?.events?.deposit_cents,
      participants: reg?.registration_participants,
      balanceCents: bal?.balance_cents,
    });
    const paid = bal?.paid_cents ?? 0;

    if (due > 0 && paid < due) {
      const fmt = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;
      return {
        ok: false,
        needsOverride: true,
        error:
          `The deposit for this registration is ${fmt(due)} and ${fmt(paid)} has been ` +
          `received. Confirming marks the places as held. Record the payment first, or ` +
          `confirm again to do it anyway.`,
      };
    }
  }

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
export async function updatePerson(registrationId, personId, fields, options = {}) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = clean(fields || {}, PERSON_FIELDS);
  if (!patch.first_name && 'first_name' in patch) {
    return { ok: false, error: 'A first name is required.' };
  }

  const supabase = await createClient();

  // ⭐ IDENTITY CHANGES ON A REGISTERED PERSON NEED A DELIBERATE YES.
  //
  // Families are blocked from this outright and told to ask staff (25 Aug).
  // That advice was only honest if the staff path is safer than the family
  // one, and it was not: this action had no check at all, and the change log
  // deliberately skips staff, so a rename left no guard and no trace.
  //
  // Staff genuinely need to do it — correcting a typo is the common case, and
  // blocking that would be worse than the problem. So it is allowed, but not
  // by accident: the caller must pass confirmIdentityChange, and the reply
  // below tells them exactly what is at stake so the confirmation is informed.
  //
  // Migration 0046 closed the other half: identity edits are now logged even
  // when staff make them.
  const identityKeys = ['first_name', 'last_name', 'date_of_birth'];
  const touchingIdentity = identityKeys.some((k) => k in patch);

  if (touchingIdentity && !options.confirmIdentityChange) {
    const { data: before } = await supabase
      .from('people')
      .select('first_name, last_name, date_of_birth')
      .eq('id', personId)
      .maybeSingle();

    const changed = identityKeys.filter(
      (k) => k in patch && (patch[k] ?? '') !== (before?.[k] ?? '')
    );

    if (changed.length > 0) {
      const { count } = await supabase
        .from('registration_participants')
        .select('id', { count: 'exact', head: true })
        .eq('person_id', personId)
        .neq('status', 'cancelled');

      if ((count ?? 0) > 0) {
        return {
          ok: false,
          needsConfirm: true,
          error:
            `${before?.first_name ?? 'This person'} ${before?.last_name ?? ''}`.trim() +
            ' is on a live registration. Changing their name or date of birth also changes ' +
            'what appears on rosters and check-in lists, and the agreements already signed ' +
            'will still carry the old name. Returning families are matched by name and date ' +
            'of birth, so an edit here can create a duplicate person at their next ' +
            'registration. This will be recorded in Recent Changes.',
        };
      }
    }
  }

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

// The two enrolment answers the family gives per person, per event. Staff need
// them because these arrive by phone as often as by form ("actually make that
// an Adult L"), and until now there was nowhere to put that.
export async function setParticipantEnrollment(registrationId, participantId, input) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = {};
  if ('tshirt' in (input || {})) {
    const v = (input.tshirt || '').trim();
    if (v && !TSHIRT_SIZES.includes(v)) return { ok: false, error: 'Unknown t-shirt size.' };
    patch.tshirt_size = v || null;
  }
  if ('firstTime' in (input || {})) {
    const v = input.firstTime;
    // '' means "not answered", which must stay null rather than becoming "no".
    patch.first_time_attending = v === '' || v == null ? null : v === true || v === 'true';
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_participants')
    .update(patch)
    .eq('id', participantId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// Record a media or directory permission on the family's behalf -- the phone
// call that says "actually, please don't use photos of Tommy after all".
//
// This INSERTS rather than updates: person_consents is append-only, because a
// withdrawn permission does not erase the fact that the earlier one was in
// force when a photo was published. recorded_as marks it as staff-entered so
// the trail shows a person typed it, not the family.
export async function setPersonConsent(registrationId, personId, kind, granted) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!['media', 'directory'].includes(kind)) return { ok: false, error: 'Unknown permission.' };
  if (typeof granted !== 'boolean') return { ok: false, error: 'Answer must be yes or no.' };

  const supabase = await createClient();
  const staff = await getStaff();

  // Don't stack identical rows: if the current answer already says this,
  // there is nothing to record.
  const { data: current } = await supabase
    .from('person_current_consents')
    .select('granted')
    .eq('person_id', personId)
    .eq('kind', kind)
    .maybeSingle();
  if (current?.granted === granted) return { ok: true };

  const { error } = await supabase.from('person_consents').insert({
    person_id: personId,
    kind,
    granted,
    recorded_by: staff?.userId ?? null,
    recorded_as: 'staff',
  });
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
// when, and the staff note -- NOT the family's statement, which belongs to
// the family and is never overwritten here).
//
// This editor is the "I already know what I'm doing" path: it sets amounts
// directly, with no reference to whether anybody asked. The answer to an
// actual request is the Approve/Decline pair on the review card.
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
    .select('id, status')
    .eq('registration_participant_id', participantId)
    .maybeSingle();

  // Two bugs lived in the three lines this replaces.
  //
  // FIRST: the note was written into family_statement, which is the family's
  // own words explaining why the fee was hard. Granting an award therefore
  // deleted the reason it had been asked for, and nothing warned anybody
  // because the note that replaced it looked like a note. 0048 gave the staff
  // note its own column.
  //
  // SECOND: clearing an amount set the status to 'withdrawn' -- a statement
  // that the FAMILY took their request back. A registrar typing 0 is not the
  // family doing anything. Now: an amount is a grant; zeroing an award that
  // was granted records that it is no longer granted; and zeroing against a
  // request nobody has answered yet leaves it waiting, because clearing a
  // figure is not a decision. Turning a request DOWN is a deliberate act with
  // its own button, in app/admin/scholarships/actions.js.
  const nextStatus =
    scholarship > 0
      ? 'granted'
      : existing?.status === 'requested'
        ? 'requested'
        : 'declined';

  const auditRow = {
    registration_participant_id: participantId,
    granted_cents: scholarship,
    status: nextStatus,
    staff_note: note || null,
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

// --- refunds -----------------------------------------------------------------
//
// Money back to a family, in full or in part (board direction, 24 Aug: credits
// alone are not enough). A refund reverses a specific PAYMENT, never a balance
// -- Stripe can only refund a charge it made, and a partial refund is
// meaningless without knowing which transaction it came out of.
//
// Two routes, deliberately kept apart:
//   * a payment Stripe handled -> ask Stripe, record what it says
//   * a check or cash payment  -> record only. The ministry writes the check;
//     the site's job is to make sure the balance and the paper agree.
//
// The database is the real guard: the trigger on payment_refunds refuses any
// total above the original payment, so a stale page or a doubled click cannot
// over-refund. The checks here exist to give a person a sentence they can
// understand instead of a constraint violation.
export async function refundPayment(registrationId, input) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };

  const { paymentId, amountCents, feeCoverCents = 0, reason, note } = input || {};
  const amount = Math.round(Number(amountCents));
  const feeCover = Math.round(Number(feeCoverCents) || 0);

  if (!paymentId) return { ok: false, error: 'Which payment is being refunded?' };
  if (!Number.isFinite(amount) || amount < 1) {
    return { ok: false, error: 'Enter a refund amount of at least $0.01.' };
  }
  if (!(reason || '').trim()) {
    // Not a database rule, a working one: a refund with no reason is
    // unanswerable when someone asks about it next year.
    return { ok: false, error: 'Please give a short reason for the refund.' };
  }

  const supabase = await createClient();

  const { data: payment, error: payError } = await supabase
    .from('payments')
    .select('id, registration_id, amount_cents, fee_cover_cents, status, method, stripe_payment_intent_id')
    .eq('id', paymentId)
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (payError || !payment) return { ok: false, error: 'That payment could not be found.' };

  const { data: priorRefunds } = await supabase
    .from('payment_refunds')
    .select('amount_cents, status')
    .eq('payment_id', paymentId);
  const alreadyRefunded = (priorRefunds ?? [])
    .filter((r) => r.status === 'pending' || r.status === 'succeeded')
    .reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const refundable = (payment.amount_cents ?? 0) - alreadyRefunded;

  if (amount > refundable) {
    return {
      ok: false,
      error:
        refundable <= 0
          ? 'This payment has already been refunded in full.'
          : `The most that can still be refunded on this payment is $${(refundable / 100).toFixed(2)}.`,
    };
  }
  if (feeCover > (payment.fee_cover_cents ?? 0)) {
    return { ok: false, error: 'That is more than the processing-fee contribution on this payment.' };
  }

  // Stripe first, database second. If Stripe refuses, nothing is recorded and
  // the family's balance is untouched -- whereas recording first and failing
  // second would show a refund that never happened.
  let stripeRefundId = null;
  let status = 'succeeded';
  let method = 'check';

  if (payment.stripe_payment_intent_id) {
    const stripe = getStripe();
    if (!stripe) {
      return { ok: false, error: 'Stripe is not configured, so this payment cannot be refunded here.' };
    }
    try {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        // Stripe's own cut is not returned, so the fee contribution is added
        // to what the family gets back only when staff have chosen to.
        amount: amount + feeCover,
        reason: 'requested_by_customer',
        metadata: {
          registration_id: registrationId,
          payment_id: paymentId,
          recorded_reason: (reason || '').slice(0, 400),
        },
      });
      stripeRefundId = refund.id;
      method = 'stripe';
      // Stripe returns 'succeeded' for cards almost always, and 'pending' for
      // bank refunds that take days. Either way the money is committed, and
      // the balance view counts both.
      status = refund.status === 'succeeded' ? 'succeeded' : 'pending';
    } catch (e) {
      return { ok: false, error: `Stripe refused the refund: ${e?.message ?? 'unknown error'}` };
    }
  }

  const { error: insertError } = await supabase.from('payment_refunds').insert({
    payment_id: paymentId,
    registration_id: registrationId,
    amount_cents: amount,
    fee_cover_cents: feeCover,
    status,
    reason: (reason || '').trim(),
    note: (note || '').trim() || null,
    method,
    stripe_refund_id: stripeRefundId,
    refunded_by: staff.userId ?? null,
    refunded_on: new Date().toISOString().slice(0, 10),
  });
  if (insertError) {
    // The money may already have left Stripe at this point, so this must be
    // loud rather than swallowed.
    console.error('refundPayment insert:', insertError.message, { stripeRefundId });
    return {
      ok: false,
      error: stripeRefundId
        ? `Stripe issued refund ${stripeRefundId}, but recording it here failed: ${insertError.message}. Tell an administrator — the balance is now wrong.`
        : `The refund could not be recorded: ${insertError.message}`,
    };
  }

  // A payment refunded down to nothing is marked refunded, so the payments
  // list stops presenting it as money the ministry holds.
  if (amount >= refundable) {
    await supabase.from('payments').update({ status: 'refunded' }).eq('id', paymentId);
  }

  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath('/admin/payments');
  revalidatePath('/account/dashboard');
  return { ok: true, status, stripeRefundId };
}
