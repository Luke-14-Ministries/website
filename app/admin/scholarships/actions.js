'use server';

// Reviewing a family's request for help with the fee.
//
// The asking side has existed since August and the granting side has existed
// since 0001 -- but they were never joined up. A family's request landed in
// `scholarships` with status 'requested', and the only staff surface that ever
// mentioned it was a light-grey list at the bottom of the registration page
// that read "$0 requested" (the query never loaded requested_cents) and
// offered no way to answer. A registrar could grant money through the
// per-person adjustments editor, but nothing connected that grant to the
// request, and there was no way at all to say no: the writer only ever set
// 'granted' or 'withdrawn', so refusing meant recording that the FAMILY had
// taken their request back. That is a false statement about someone who asked
// the ministry for help, and it is the reason 'declined' -- legal in the CHECK
// constraint since day one -- had never once been written.
//
// These two actions are the answer to the request. They are deliberately the
// ONLY writers of 'declined', and they are shared by both surfaces (the
// registration page and the Scholarship Requests queue) so a decision means
// the same thing wherever it is made.
//
// Security: the registrar check here yields a friendly message; row-level
// security on `scholarships` and `registration_participants` is the actual
// boundary. Both run as the signed-in user.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

async function requireRegistrar() {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return { error: 'You do not have permission to review scholarship requests.' };
  }
  return { staff };
}

function revalidateAll(registrationId) {
  revalidatePath('/admin/scholarships');
  revalidatePath('/account/dashboard');
  if (registrationId) {
    revalidatePath(`/admin/registrations/${registrationId}`);
    revalidatePath(`/account/scholarship/${registrationId}`);
  }
}

const toCents = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
};

// Grant the award. The amount is whatever the registrar decided -- it is NOT
// required to equal what the family asked for, because the ministry routinely
// gives more than was asked and sometimes less than it would like to.
export async function grantScholarship({ registrationId, participantId, amount, note }) {
  const { staff, error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!participantId) return { ok: false, error: 'Which person?' };

  const cents = toCents(amount);
  if (cents === null) return { ok: false, error: 'Enter an amount, in dollars.' };
  if (cents <= 0) {
    // A "grant" of nothing is a refusal wearing the wrong word, and it would
    // leave the family reading "granted" beside $0.
    return {
      ok: false,
      error: 'A scholarship has to be more than $0. To turn the request down, use Decline.',
    };
  }

  const supabase = await createClient();

  const { data: part, error: readError } = await supabase
    .from('registration_participants')
    .select('id, fee_cents, discount_cents')
    .eq('id', participantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!part) return { ok: false, error: 'That person is no longer on this registration.' };

  const discount = part.discount_cents ?? 0;
  const fee = part.fee_cents ?? 0;
  if (cents + discount > fee) {
    // Same rule the adjustments editor enforces, stated in the numbers the
    // registrar is actually looking at rather than in the abstract.
    const room = Math.max(0, fee - discount);
    return {
      ok: false,
      error:
        discount > 0
          ? `That is more than this person owes. The fee is $${(fee / 100).toFixed(2)} and $${(discount / 100).toFixed(2)} is already discounted, so the most you can award is $${(room / 100).toFixed(2)}.`
          : `That is more than the fee of $${(fee / 100).toFixed(2)}.`,
    };
  }

  // The amount lives on the participant row -- that is what
  // registration_balances subtracts, so granting here flows into the family's
  // balance, their dashboard, and the printable statement with no further
  // steps.
  const { error: partError } = await supabase
    .from('registration_participants')
    .update({ scholarship_cents: cents })
    .eq('id', participantId);
  if (partError) return { ok: false, error: partError.message };

  // The scholarships row is the decision record. family_statement is NOT
  // touched: it is the family's own words and 0048 gave the staff note its own
  // column precisely so a grant stops erasing them.
  const decision = {
    granted_cents: cents,
    status: 'granted',
    staff_note: String(note ?? '').trim() || null,
    reviewed_by: staff.userId,
    reviewed_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('scholarships')
    .select('id')
    .eq('registration_participant_id', participantId)
    .maybeSingle();

  const { error: auditError } = existing
    ? await supabase.from('scholarships').update(decision).eq('id', existing.id)
    : await supabase
        .from('scholarships')
        .insert({ registration_participant_id: participantId, ...decision });

  if (auditError) {
    // Never swallowed: the money moved on the participant row, and a family
    // whose balance dropped with no record of who decided it is exactly the
    // gap the audit table exists to close.
    return {
      ok: false,
      error: `The award saved, but the decision record did not: ${auditError.message}`,
    };
  }

  revalidateAll(registrationId);
  return { ok: true };
}

// Turn the request down. The note is required -- see below.
export async function declineScholarship({ registrationId, participantId, note }) {
  const { staff, error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!participantId) return { ok: false, error: 'Which person?' };

  const reason = String(note ?? '').trim();
  if (!reason) {
    // The family will ring the office about this, and whoever answers the
    // phone is not the person who made the decision. The same rule the
    // cancellation queue applies to families applies to staff here: a refusal
    // with no reason attached leaves the next conversation starting from
    // nothing. Staff see this note; the family sees only the outcome.
    return {
      ok: false,
      error: 'Say briefly why — the office will need it when the family asks.',
    };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('scholarships')
    .select('id')
    .eq('registration_participant_id', participantId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, error: 'There is no request here to decline.' };
  }

  const { error } = await supabase
    .from('scholarships')
    .update({
      granted_cents: 0,
      status: 'declined',
      staff_note: reason,
      reviewed_by: staff.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
  if (error) return { ok: false, error: error.message };

  // Anything previously awarded comes off the participant row, so the balance
  // and the decision can never disagree.
  const { error: partError } = await supabase
    .from('registration_participants')
    .update({ scholarship_cents: 0 })
    .eq('id', participantId);
  if (partError) {
    return {
      ok: false,
      error: `Recorded as declined, but the amount on the person did not clear: ${partError.message}`,
    };
  }

  revalidateAll(registrationId);
  return { ok: true };
}
