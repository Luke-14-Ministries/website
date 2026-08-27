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
// Reconcile Checkr's results export.
//
// Written against a REAL export (27 Aug), not a guess, and two things in that
// file would have caused real harm if this had shipped on assumptions.
//
// 1. STATUS IS NOT THE RESULT. Checkr's export has both `Status` and
//    `Assessment`. `Status` says whether the report FINISHED -- it reads
//    "complete" on every finished report, including one that came back
//    "consider". `Assessment` is the verdict. Reading Status as the result
//    would have marked a volunteer with a criminal-record hit as CLEARED, on a
//    safeguarding record, silently. So: Status decides whether we have an
//    answer yet; Assessment decides what the answer is.
//
// 2. "Candidate email" IS NOT ALWAYS THE CANDIDATE'S. In the sample export,
//    two reports for a person named Steve Wayne Gillespie both carry
//    ellen@luke14ministries.net -- the staff member who ordered them by hand.
//    Matching on email alone would have tied someone else's background check
//    to Ellen's record. Anything ordered through THIS screen carries the right
//    address (invited_email, migration 0057), so email matching is exact for
//    our own batches; older hand-ordered checks fall back to an exact
//    full-name match, and the preview says which method was used so a person
//    decides before anything is written.
// 3. CHECKR'S WORDS ARE NOT OUR WORDS. checkr_status has been a constrained
//    column since 0029 -- eight values the site chose. The real export's
//    Assessment reads "review", which is not one of them, so writing it
//    through would have failed the check constraint at the moment of import,
//    with a message about a constraint, AFTER a preview that said the row was
//    fine. So the verdict is mapped into our vocabulary here and Checkr's own
//    word is kept verbatim in `assessment` (migration 0060).
//
//    Everything that means "a person must look at this" collapses to
//    'consider'. That is not a loss: nothing about how the site behaves turns
//    on the difference between "review" and "consider", and both mean nobody
//    is cleared.
const VERDICT_TO_STATUS = new Map([
  ['clear', 'clear'],
  ['consider', 'consider'],
  ['review', 'consider'],
  ['escalated', 'consider'],
  ['pending', 'pending'],
  ['processing', 'pending'],
  ['in progress', 'pending'],
  ['suspended', 'suspended'],
  ['dispute', 'dispute'],
  ['disputed', 'dispute'],
  ['canceled', 'canceled'],
  ['cancelled', 'canceled'],
]);

function parseCsv(text) {
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

const norm = (v) => (v || '').trim().toLowerCase();
const normName = (v) => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function importCheckrResults(csvText, { dryRun = true } = {}) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) return { ok: false, error: 'Not permitted.' };
  if (!can(staff, 'background_checks')) return { ok: false, error: 'Not permitted.' };

  const rows = parseCsv(csvText || '');
  if (rows.length < 2) return { ok: false, error: 'That file has no rows in it.' };

  // Column names are matched loosely so a change of case or spacing in
  // Checkr's export does not break this -- but the columns themselves are
  // named explicitly, because guessing which column meant "result" is the
  // mistake this whole comment block exists to prevent.
  const header = rows[0].map((h) => norm(h));
  const at = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iEmail = at('candidate email', 'email');
  const iName = at('candidate full name', 'candidate name');
  const iAssess = at('assessment');
  const iStatus = at('status', 'report status');
  const iDone = at('completed at');
  const iReport = at('report id');
  const iCand = at('candidate id');
  const iPackage = at('package');
  const iAdj = at('adjudication');
  const iOrderedBy = at('report ordered by');
  const iSex = at('sex_offender_search', 'sex offender search');

  // EVERY screening column, not just the sex-offender one. The ministry wants
  // all flags (27 Aug): sexual offences are priority one, but a drink-driving
  // or possession conviction is something they want the chance to address, and
  // an overall "consider" does not say which search produced it.
  //
  // Found by shape rather than by a fixed list, because Checkr's screening set
  // varies by package -- the two sample rows carry different ones. Anything
  // ending in _search or _trace is a screening; the administrative columns are
  // named explicitly above and skipped here.
  const ADMIN_COLS = new Set([
    'report id', 'candidate id', 'custom id', 'completed at', 'created at',
    'estimated completion', 'candidate full name', 'candidate email',
    'dl state', 'dl number', 'adjudicated at', 'adjudication',
    'adjudicator email', 'assessment', 'assessment_status', 'package',
    'status', 'geos', 'report ordered by', 'cost center',
  ]);
  const screeningCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && !ADMIN_COLS.has(h) && (h.endsWith('_search') || h.endsWith('_trace')));

  if (iEmail === -1 && iName === -1) {
    return {
      ok: false,
      error:
        'This file has neither a candidate email nor a candidate name column, so results cannot ' +
        `be matched to anyone. Headings found: ${header.join(', ')}`,
    };
  }
  // A clearance row with provider 'checkr' and any status other than
  // 'not_started' must carry a Checkr candidate id -- a constraint from 0029,
  // and a good one: it is what makes a record traceable back to a report. A
  // billing or usage export has no such column, and pasting one here would
  // fail at the write with a constraint name rather than an explanation.
  if (iCand === -1) {
    return {
      ok: false,
      error:
        'No "Candidate ID" column. This looks like a billing or usage export rather than the ' +
        'Reports export — without a candidate id a result cannot be tied back to the report it ' +
        'came from. Export from Checkr\u2019s Reports screen instead.',
    };
  }
  if (iAssess === -1) {
    return {
      ok: false,
      error:
        'No "Assessment" column. That column holds the verdict (clear / consider); "Status" only ' +
        'says whether the report finished. Refusing to import rather than guess which is which.',
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('person_clearances')
    .select('person_id, invited_email');
  const { data: people } = await supabase
    .from('people')
    .select('id, first_name, last_name');

  const byEmail = new Map();
  const haveRow = new Set();
  for (const r of existing ?? []) {
    haveRow.add(r.person_id);
    if (r.invited_email) byEmail.set(norm(r.invited_email), r.person_id);
  }
  // Exact full-name match only, and only where the name is UNIQUE in the
  // database. Two Steve Gillespies means no match and a line in the report --
  // far better than tying a background check to the wrong person.
  const nameCount = new Map();
  const byName = new Map();
  for (const p of people ?? []) {
    const key = normName(`${p.first_name ?? ''} ${p.last_name ?? ''}`);
    if (!key.trim()) continue;
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
    byName.set(key, p.id);
  }

  // A word in the Assessment column that this importer has never seen is
  // treated as "consider" -- the cautious direction -- but it is NOT treated
  // silently. Checkr can add a verdict, and a new word quietly filed as
  // "needs review" is fine; a new word quietly filed as "cleared" would not
  // be, and the only way to keep that distinction honest is to say out loud
  // which words were not recognised.
  const unrecognised = new Set();
  const matched = [], unmatched = [], updates = [];
  for (const r of rows.slice(1)) {
    const email = iEmail === -1 ? '' : norm(r[iEmail]);
    const orderedBy = iOrderedBy === -1 ? '' : norm(r[iOrderedBy]);
    const fullName = iName === -1 ? '' : (r[iName] || '').trim();
    const verdict = norm(r[iAssess]);
    const reportState = iStatus === -1 ? 'complete' : norm(r[iStatus]);

    // WHOSE ADDRESS IS IN THE EMAIL COLUMN?
    //
    // On a check ordered by hand at Checkr, "Candidate email" holds the staff
    // member who placed the order, not the person being screened. Both sample
    // rows for Steve Wayne Gillespie carry ellen@luke14ministries.net, and
    // "Report Ordered By" carries the same address. That equality is the tell,
    // and it is worth acting on: Ellen is herself a volunteer, so matching on
    // that address would have filed a stranger's criminal-record hit against
    // HER safeguarding record -- a wrong answer that reads as a right one.
    //
    // Anything ordered through this screen carries the candidate's own address
    // (invited_email, migration 0057), and the orderer is different, so real
    // batches are unaffected.
    const emailIsOrderers = !!email && email === orderedBy;
    const nameKey = normName(fullName);
    const nameId = nameKey && nameCount.get(nameKey) === 1 ? byName.get(nameKey) : undefined;

    let personId = emailIsOrderers || !email ? undefined : byEmail.get(email);
    let how = personId ? 'email' : null;

    // Email says one person, name says another. There is no safe way to prefer
    // one over the other, so neither wins -- the row is listed for a human.
    if (personId && nameId && nameId !== personId) {
      unmatched.push({
        name: fullName || '(no name)',
        email: email || '(no email)',
        verdict,
        why: 'the address on this row belongs to one person and the name to another — match it by hand',
      });
      continue;
    }
    if (!personId && nameId) { personId = nameId; how = 'name'; }

    if (!personId) {
      unmatched.push({
        name: fullName || '(no name)',
        email: email || '(no email)',
        verdict,
        why: nameKey && nameCount.get(nameKey) > 1
          ? 'more than one person has that name — match it by hand'
          : emailIsOrderers
            ? 'the email on this row is the staff member who ordered it, not the candidate, and no unique person has that name'
            : 'nobody in the system matches this name or address',
      });
      continue;
    }

    // Finished? Then the verdict counts. Not finished? Still pending, whatever
    // the Assessment column happens to say.
    const finished = reportState === 'complete' || reportState === 'completed';
    const mapped = VERDICT_TO_STATUS.get(verdict);
    if (finished && mapped === undefined) unrecognised.add(verdict || '(blank)');
    const cleared = finished && mapped === 'clear';
    const status = finished ? mapped ?? 'consider' : 'pending';
    const completedOn =
      (iDone !== -1 && (r[iDone] || '').trim().slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);

    // Verdict words only. What was found stays in the report in SharePoint.
    const screenings = {};
    for (const { h, i } of screeningCols) {
      const v = norm(r[i]);
      if (v) screenings[h] = v;
    }
    // Anything that is not a plain "clear" or an administrative "complete" is
    // worth a person's eye, whichever search produced it.
    const flagged = Object.entries(screenings)
      .filter(([, v]) => v !== 'clear' && v !== 'complete')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`);

    matched.push({
      name: fullName || email,
      verdict: verdict || '(blank)',
      reportState,
      completedOn,
      cleared,
      how,
      sexOffender: iSex === -1 ? '' : norm(r[iSex]),
      screenings,
      flagged,
    });

    updates.push({
      _completedOn: completedOn,
      _cleared: cleared,
      person_id: personId,
      provider: 'checkr',
      checkr_status: status,
      // Checkr's own word, unmapped. See 0060.
      ...(verdict ? { assessment: verdict } : {}),
      matched_by: how,
      ...(iReport !== -1 && (r[iReport] || '').trim()
        ? { checkr_report_id: (r[iReport] || '').trim() } : {}),
      ...(iCand !== -1 && (r[iCand] || '').trim()
        ? { checkr_candidate_id: (r[iCand] || '').trim() } : {}),
      ...(iPackage !== -1 && (r[iPackage] || '').trim()
        ? { checkr_package: (r[iPackage] || '').trim() } : {}),
      ...(iAdj !== -1 && norm(r[iAdj]) ? { adjudication: norm(r[iAdj]) } : {}),
      ...(iSex !== -1 && norm(r[iSex]) ? { sex_offender_result: norm(r[iSex]) } : {}),
      ...(Object.keys(screenings).length ? { screening_results: screenings } : {}),
      // ONLY a finished report with a clear assessment sets the flag staff act
      // on. "consider", a dispute, a blank -- all leave it alone for a person
      // to decide. Software must not adjudicate a background check.
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

  // ONE REPORT PER PERSON, AND IT MUST BE THE CURRENT ONE.
  //
  // A person can appear more than once: Checkr keeps every report, and a
  // re-check produces a second row. The sample export (27 Aug) has exactly
  // this -- two reports for one candidate, the NEWER one "consider" and the
  // older one "clear" -- and the newer one is listed FIRST. Applying updates in
  // file order would have written the older clear report last and marked him
  // cleared on the strength of a superseded result.
  //
  // So: the most recently COMPLETED report wins, whatever order the file is in.
  // Where two share a completion date, the more cautious verdict wins -- a tie
  // is not a reason to clear somebody.
  const latest = new Map();
  for (const u of updates) {
    const prev = latest.get(u.person_id);
    if (!prev) { latest.set(u.person_id, u); continue; }
    const newer = u._completedOn > prev._completedOn;
    const sameDayButStricter =
      u._completedOn === prev._completedOn && prev._cleared && !u._cleared;
    if (newer || sameDayButStricter) latest.set(u.person_id, u);
  }
  const finalUpdates = [...latest.values()];

  // Say which rows lost, not just how many. `matched` and `updates` are built
  // in the same pass and stay index-for-index, so the winning update objects
  // identify the winning rows by reference. A count on its own ("2 matched,
  // 1 applied") is the silent discrepancy this screen exists to prevent --
  // the coordinator needs to see that the 12 Aug "clear" was set aside in
  // favour of the 13 Aug "consider", and not wonder where a row went.
  const keep = new Set(finalUpdates);
  for (let i = 0; i < matched.length; i += 1) {
    if (!keep.has(updates[i])) matched[i].superseded = true;
  }
  const superseded = matched.filter((m) => m.superseded).length;

  if (dryRun) {
    return {
      ok: true, dryRun: true, matched, unmatched, superseded,
      unrecognised: [...unrecognised],
      willUpdate: finalUpdates.length,
      willClear: finalUpdates.filter((u) => u._cleared).length,
      willCreate: finalUpdates.filter((u) => !haveRow.has(u.person_id)).length,
      byName: matched.filter((m) => m.how === 'name').length,
    };
  }

  // UPSERT, NOT UPDATE.
  //
  // A check ordered by hand at Checkr, before this screen existed, has no row
  // here to update -- and an UPDATE that matches nothing is not an error. The
  // import would have reported "3 updated" and written one. Upserting means a
  // result always lands somewhere, and if the row is new the adult-only
  // trigger (migration 0056) gets its say, loudly, instead of nothing
  // happening quietly.
  for (const u of finalUpdates) {
    const { _completedOn, _cleared, ...row } = u;
    const { error } = await supabase
      .from('person_clearances')
      .upsert(row, { onConflict: 'person_id' });
    if (error) return { ok: false, error: `${error.message} (stopped part-way)` };
  }

  revalidatePath('/admin/volunteers');
  return {
    ok: true, dryRun: false, updated: finalUpdates.length, superseded, matched, unmatched,
    unrecognised: [...unrecognised],
  };
}
