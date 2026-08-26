'use client';

// One scholarship request, and the two things a registrar can do about it.
//
// Shared by the staff registration page and the Scholarship Requests queue on
// purpose. A decision has to mean the same thing wherever it is made, and the
// fastest way for two screens to drift apart is to give each its own buttons.
//
// The tone rule the rest of the admin follows applies here too: amber is work
// outstanding — a queue that drains when somebody acts. A settled request
// stops being amber the moment it is answered, because a badge nobody can
// clear teaches staff that badges are wallpaper.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { grantScholarship, declineScholarship } from './actions';

const money = (c) =>
  typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '—';

const SETTLED = {
  granted: ['Granted', 'bg-green-100 text-green-800'],
  declined: ['Not granted', 'bg-neutral-200 text-neutral-700'],
  withdrawn: ['Withdrawn by family', 'bg-neutral-100 text-neutral-500'],
};

export default function ScholarshipReview({ row, showRegistrationLink = false }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  // Pre-filled with what the family asked for, because that is the answer
  // most of the time and retyping it is how a $450 request becomes a $45
  // award. Blank when they named no amount — see the copy below.
  const [amount, setAmount] = useState(
    row.requestedCents ? (row.requestedCents / 100).toFixed(2) : ''
  );
  const [note, setNote] = useState('');

  const isOpen = row.status === 'requested';
  const room = Math.max(0, (row.feeCents ?? 0) - (row.discountCents ?? 0));

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function approve() {
    run(() =>
      grantScholarship({
        registrationId: row.registrationId,
        participantId: row.participantId,
        amount,
        note,
      })
    );
  }

  function decline() {
    if (!note.trim()) {
      setError('Say briefly why — the office will need it when the family asks.');
      return;
    }
    if (
      !confirm(
        `Turn down the request for ${row.name}?\n\nThey will see "Not granted this time" on their scholarship page, and they can ask again. Your note stays with staff.`
      )
    )
      return;
    run(() =>
      declineScholarship({
        registrationId: row.registrationId,
        participantId: row.participantId,
        note,
      })
    );
  }

  const [settledLabel, settledClass] = SETTLED[row.status] ?? SETTLED.withdrawn;

  return (
    <div
      className={`rounded-lg border p-5 ${
        isOpen
          ? 'border-amber-300 bg-amber-50 shadow-sm'
          : 'border-neutral-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">
          {row.name}
          {row.roleLabel && (
            <span className="ml-2 text-sm font-normal text-neutral-500">{row.roleLabel}</span>
          )}
          {(row.household || row.eventName) && (
            <span className="ml-2 text-sm font-normal text-neutral-500">
              {[row.household, row.eventName].filter(Boolean).join(' · ')}
            </span>
          )}
        </h3>
        {isOpen ? (
          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900">
            Needs a decision
          </span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${settledClass}`}>
            {settledLabel}
            {row.status === 'granted' && <> · {money(row.grantedCents)}</>}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-neutral-700">
        {/* requested_cents is nullable and the family's form lets them send 0
            rather than name a figure -- "I don't know what to ask for" is a
            real answer. Saying "$0 requested", which is what this screen used
            to say for EVERY request because the query never loaded the
            column, reads as a request for nothing. */}
        {row.requestedCents ? (
          <>
            Asked for <span className="font-semibold">{money(row.requestedCents)}</span> toward a{' '}
            {money(row.feeCents)} fee
          </>
        ) : (
          <>
            Asked for help without naming an amount · fee {money(row.feeCents)}
          </>
        )}
        {(row.discountCents ?? 0) > 0 && (
          <> · {money(row.discountCents)} already discounted, so up to {money(room)} can be awarded</>
        )}
      </p>

      {row.familyStatement ? (
        <p className="mt-2 rounded border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
          &ldquo;{row.familyStatement}&rdquo;
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-neutral-500">They did not write anything.</p>
      )}

      <p className="mt-2 text-xs text-neutral-500">
        {row.requestedAt && <>Asked {String(row.requestedAt).slice(0, 10)}</>}
        {/* An open request that already carries a decision is a family asking
            a second time after being turned down. Saying "answered" about a
            row that is plainly still waiting would be the screen contradicting
            itself. */}
        {row.reviewedAt && (
          <>
            {' '}
            · {isOpen ? 'previously answered' : 'answered'}{' '}
            {String(row.reviewedAt).slice(0, 10)}
          </>
        )}
        {row.reviewedBy && <> by {row.reviewedBy}</>}
      </p>

      {row.staffNote && (
        <p className="mt-2 text-sm text-neutral-600">
          <span className="font-semibold">
            {isOpen ? 'Staff note from last time:' : 'Staff note:'}
          </span>{' '}
          {row.staffNote}
        </p>
      )}

      {showRegistrationLink && (
        <div className="mt-3">
          <Link
            href={`/admin/registrations/${row.registrationId}`}
            className="text-sm text-brand underline font-semibold"
          >
            Open the whole registration
          </Link>
        </div>
      )}

      {isOpen && (
        <div className="mt-4 border-t border-amber-200 pt-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label
                className="block text-xs font-semibold text-neutral-700 mb-1"
                htmlFor={`amt-${row.participantId}`}
              >
                Award ($)
              </label>
              <input
                id={`amt-${row.participantId}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold text-neutral-700 mb-1"
                htmlFor={`note-${row.participantId}`}
              >
                {/* The old placeholder read "approved by Larry 26 Aug", which
                    taught registrars to type a name and a date that the record
                    already holds -- reviewed_by and reviewed_at are stamped on
                    the decision and printed on the answered card. Typed dates
                    also go stale and can be wrong; the stamp cannot. So the
                    note is for the one thing nothing else captures: WHY. */}
                Note <span className="font-normal text-neutral-500">— required to decline, optional on an award. Your name and the date are saved automatically, so use this to say <em>why</em>. Staff only; the family does not see it.</span>
              </label>
              <input
                id={`note-${row.participantId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Board hardship fund; spoke with the family by phone"
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={approve}
              disabled={pending}
              className="btn-primary !py-1.5 text-sm disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Approve this award'}
            </button>
            <button
              onClick={decline}
              disabled={pending}
              className="btn-outline !py-1.5 text-sm disabled:opacity-50"
            >
              Decline
            </button>
            <span className="text-xs text-neutral-600">
              Approving takes the amount straight off what this family owes.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
