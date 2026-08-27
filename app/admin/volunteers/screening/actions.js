'use server';

// Bulk background screening, without an API.
//
// Checkr sells API access behind a $500 certification course. It buys
// automation and nothing else: their dashboard's bulk upload takes a CSV of
// "email, first name, phone" and sends every person the same hosted invitation
// the API would, so the Social Security number is typed into Checkr's form and
// never touches us either way. At twenty to forty checks a year the course
// cost cannot be recovered in saved minutes, so the flow here is deliberately
// file-based:
//
//   1. The site works out who is due and writes Checkr's exact CSV.
//   2. A coordinator uploads that file at dashboard.checkr.com.
//   3. Checkr's results CSV comes back and the site reconciles it.
//
// Two file moves per batch, no API key to protect, no webhook to go silently
// wrong -- and the same privacy guarantee.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

// How long a check stands before the person is due again.
//
// THREE YEARS IS TODAY'S PRACTICE, NOT A DECISION. The board is weighing
// annual re-checks against the current three-year cycle, and the arithmetic is
// close: annual on Basic Plus and triennial on Complete Criminal land within
// about $150 of each other at this ministry's volume. Change this one number
// if they choose annual -- and note it only affects checks recorded FROM THEN
// ON, because expires_on is stored per row. Existing dates are history and are
// deliberately left alone.
const DEFAULT_INTERVAL_MONTHS = 36;

function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const normEmail = (v) => (v || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Record that a batch has been sent.
//
// Called when the coordinator downloads the CSV -- NOT when Checkr confirms
// anything, because Checkr has no way to tell us. That is an honest weakness
// of a file-based flow and the status name says so: 'invited' means "we put
// them on a list and sent it", not "Checkr has them". The reconcile step is
// what turns a claim into a fact.
export async function markBatchOrdered(personIds, batch, reason = 'volunteer') {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!Array.isArray(personIds) || personIds.length === 0) {
    return { ok: false, error: 'Nobody was selected.' };
  }

  const supabase = await createClient();

  const { data: people, error: peopleError } = await supabase
    .from('people')
    .select('id, first_name, last_name, email, phone, date_of_birth')
    .in('id', personIds);
  if (peopleError) return { ok: false, error: 'Could not read those people.' };

  const now = new Date().toISOString();
  const skipped = [];
  const rows = [];

  for (const p of people ?? []) {
    const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Someone';
    // Checkr's bulk template makes email the one required column, so a person
    // without one cannot be ordered at all. Saying which person, by name, is
    // the difference between a fixable problem and a silent short batch.
    if (!normEmail(p.email)) {
      skipped.push(`${name} — no email address on file`);
      continue;
    }
    // The database refuses a Checkr order for a minor or for anyone whose age
    // we do not know (migration 0056). Catching it here too means the
    // coordinator is told before the file is built rather than after.
    if (!p.date_of_birth) {
      skipped.push(`${name} — no date of birth on file, so we cannot confirm they are 18`);
      continue;
    }
    rows.push({
      person_id: p.id,
      provider: 'checkr',
      checkr_status: 'invited',
      screening_reason: reason,
      invited_email: normEmail(p.email),
      order_batch: batch,
      ordered_by: staff.userId,
      ordered_at: now,
      invitation_sent_at: now,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: 'Nobody in that selection could be ordered.', skipped };
  }

  const { error } = await supabase
    .from('person_clearances')
    .upsert(rows, { onConflict: 'person_id' });
  if (error) return { ok: false, error: error.message, skipped };

  // The file is built HERE, in the same action that records the batch, and
  // handed back with it. Downloading and marking must not be two buttons: a
  // coordinator who downloads and forgets to mark leaves the site believing
  // nobody was ordered, and the next batch invites all of them again -- at
  // about $26.50 each. One click, one record, one file.
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const csv = [
    // Checkr's own template header, reproduced exactly. Their parser reads
    // these strings; "first name" is not "First Name" to it.
    'email (required),first name (optional),phone number (optional)',
    ...rows.map((r) => {
      const p = byId.get(r.person_id);
      // Digits only. Checkr's example is a bare 10-digit number, and
      // "(423) 748-4954" is the kind of thing a strict parser rejects for the
      // whole row rather than the one field.
      const phone = (p?.phone ?? '').replace(/\D/g, '');
      const first = (p?.first_name ?? '').replace(/[",\n]/g, ' ').trim();
      return `${r.invited_email},${first},${phone}`;
    }),
  ].join('\r\n');

  revalidatePath('/admin/volunteers');
  return {
    ok: true,
    ordered: rows.length,
    skipped,
    csv,
    filename: `luke14-checkr-${batch.slice(0, 10)}-${rows.length}.csv`,
  };
}

// ---------------------------------------------------------------------------
// Reconcile Checkr's results CSV.
//
// COLUMN-TOLERANT ON PURPOSE. Checkr's export has changed shape before and
// differs between the Reports export and the billing usage file. Rather than
// hard-code a header row that will drift, this finds the email column by
// looking for a header containing "email" and the status by one containing
// "status", and reports what it found. A parser that guesses wrong loudly is
// recoverable; one that guesses wrong quietly writes nonsense into a
// safeguarding record.
const CLEAR_STATES = new Set(['clear', 'complete', 'completed', 'passed']);
const OPEN_STATES = new Set(['pending', 'processing', 'invited', 'in progress']);

function parseCsv(text) {
  // Small hand-rolled reader: Checkr quotes fields containing commas, and a
  // dependency for this is not worth carrying.
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function importCheckrResults(csvText, { dryRun = true } = {}) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };

  const rows = parseCsv(csvText || '');
  if (rows.length < 2) return { ok: false, error: 'That file has no rows in it.' };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const emailAt = header.findIndex((h) => h.includes('email'));
  const statusAt = header.findIndex((h) => h.includes('status'));
  const dateAt = header.findIndex((h) => h.includes('completed') || h.includes('date'));
  const idAt = header.findIndex((h) => h.includes('report') && h.includes('id'));

  if (emailAt === -1) {
    return {
      ok: false,
      error:
        'No column with "email" in its heading, so results cannot be matched to anyone. ' +
        `Headings found: ${header.join(', ')}`,
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('person_clearances')
    .select('person_id, invited_email, checkr_status, order_batch')
    .not('invited_email', 'is', null);

  const byEmail = new Map((existing ?? []).map((r) => [normEmail(r.invited_email), r]));

  const matched = [], unmatched = [], updates = [];
  for (const r of rows.slice(1)) {
    const email = normEmail(r[emailAt]);
    if (!email) continue;
    const status = (statusAt === -1 ? '' : r[statusAt] || '').trim().toLowerCase();
    const found = byEmail.get(email);

    if (!found) {
      // Not an error. It is usually somebody ordered before this screen
      // existed, or checked for another organisation entirely. Listed rather
      // than swallowed so a coordinator can see the file was not all used.
      unmatched.push({ email, status });
      continue;
    }

    const cleared = CLEAR_STATES.has(status);
    const open = OPEN_STATES.has(status);
    const completedOn =
      (dateAt !== -1 && (r[dateAt] || '').trim().slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);

    matched.push({ email, status, cleared });
    updates.push({
      person_id: found.person_id,
      checkr_status: cleared ? 'clear' : open ? 'pending' : status || 'consider',
      checkr_report_id: idAt === -1 ? undefined : (r[idAt] || '').trim() || undefined,
      // ONLY a clear result sets the flag staff act on. Anything else --
      // "consider", a dispute, a blank -- leaves it alone and needs a person
      // to look. Software must not adjudicate a background check.
      ...(cleared
        ? {
            background_check_on_file: true,
            background_check_date: completedOn,
            expires_on: addMonths(completedOn, DEFAULT_INTERVAL_MONTHS),
            report_completed_at: new Date(`${completedOn}T00:00:00Z`).toISOString(),
          }
        : {}),
      last_synced_at: new Date().toISOString(),
    });
  }

  // Always previewed before it is written. A safeguarding record is not the
  // place to find out afterwards that a column meant something else.
  if (dryRun) {
    return { ok: true, dryRun: true, matched, unmatched, willUpdate: updates.length };
  }

  for (const u of updates) {
    const { person_id, ...rest } = u;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const { error } = await supabase
      .from('person_clearances')
      .update(clean)
      .eq('person_id', person_id);
    if (error) return { ok: false, error: `${error.message} (stopped part-way)` };
  }

  revalidatePath('/admin/volunteers');
  return { ok: true, dryRun: false, updated: updates.length, matched, unmatched };
}
