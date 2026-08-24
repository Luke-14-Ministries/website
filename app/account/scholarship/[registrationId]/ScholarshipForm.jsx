'use client';

// One card per person on the registration. Asking is meant to feel ordinary,
// because it is: the ministry raises money so that cost is not the reason
// someone stays home, and a form that reads like a means test discourages
// exactly the families it exists for.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestScholarship, withdrawScholarship } from './actions';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;

const STATUS = {
  requested: ['Requested — staff will review', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Not granted this time', 'bg-neutral-200 text-neutral-600'],
  withdrawn: ['Withdrawn', 'bg-neutral-200 text-neutral-600'],
};

function PersonCard({ registrationId, row, agreementReady = true, agreementKey = null }) {
  const router = useRouter();
  const granted = (row.grantedCents ?? 0) > 0;
  const [open, setOpen] = useState(Boolean(row.status) && row.status !== 'withdrawn' && !granted);
  const [amount, setAmount] = useState(
    row.requestedCents ? String(Math.round(row.requestedCents / 100)) : ''
  );
  const [statement, setStatement] = useState(row.statement ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!agreementReady) {
      setError('Please tick the scholarship agreement above first — it covers every request on this registration.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await requestScholarship(registrationId, row.participantId, {
      amount: amount === '' ? 0 : amount,
      statement,
      agreementKey,
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  async function withdraw() {
    if (!confirm('Withdraw this request? You can ask again later if things change.')) return;
    setBusy(true);
    setError('');
    const res = await withdrawScholarship(registrationId, row.participantId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setOpen(false);
      router.refresh();
    }
  }

  const chip = row.status ? STATUS[row.status] : null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{row.name}</h2>
          <p className="text-sm text-neutral-500">
            Fee {money(row.feeCents)}
            {granted && (
              <span className="text-green-700 font-semibold">
                {' '}
                &middot; {money(row.grantedCents)} scholarship awarded
              </span>
            )}
          </p>
        </div>
        {chip && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip[1]}`}>
            {chip[0]}
          </span>
        )}
      </div>

      {granted ? (
        <p className="mt-3 text-sm text-neutral-700">
          Camp staff have applied this to {row.name}&rsquo;s fee — you&rsquo;ll see it on your
          balance. If something has changed, please contact the office rather than editing this.
        </p>
      ) : !open ? (
        <button onClick={() => setOpen(true)} className="btn-outline !py-1.5 text-sm mt-3">
          {row.status === 'withdrawn' ? 'Ask again' : `Request help for ${row.name}`}
        </button>
      ) : (
        <div className="mt-4">
          <label className="block font-semibold mb-1.5">
            How much would help? <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-neutral-500">$</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 rounded border border-neutral-300 px-3 py-2"
              placeholder="0"
            />
            <span className="text-sm text-neutral-500">of {money(row.feeCents)}</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Leave it blank if you&rsquo;d rather not name a number — staff will work it out with
            you.
          </p>

          <label className="block font-semibold mb-1.5 mt-4">
            Anything you&rsquo;d like us to know?{' '}
            <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Only the small group of staff who handle scholarships will read this. You do not
            need to explain or justify — a sentence is plenty.
          </p>

          {error && (
            <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={save} disabled={busy} className="btn-primary !py-2 text-sm">
              {busy ? 'Saving…' : row.status === 'requested' ? 'Update request' : 'Send request'}
            </button>
            {row.status === 'requested' && (
              <button onClick={withdraw} disabled={busy} className="text-sm text-neutral-600 underline">
                Withdraw
              </button>
            )}
            {saved && <span className="text-sm font-semibold text-green-700">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScholarshipForm({
  registrationId,
  rows,
  agreement = null,
  agreementSigned = false,
}) {
  // The scholarship agreement moved here from the registration form (24 Aug):
  // signed by the families it binds, at the moment it starts to apply, rather
  // than by every family whether or not it means anything to them. One tick
  // covers all requests on this registration; once signed (here or in a past
  // request) it is shown, not re-asked -- signatures are never re-taken.
  const [agreed, setAgreed] = useState(agreementSigned);
  const needsAgreement = Boolean(agreement) && !agreementSigned;

  if (rows.length === 0) {
    return <p className="text-neutral-600">Nobody is on this registration yet.</p>;
  }
  return (
    <div className="space-y-4">
      {agreement && (
        <div
          className={`rounded-lg border p-5 ${
            agreementSigned ? 'border-green-300 bg-green-50' : 'border-neutral-200 bg-white shadow-sm'
          }`}
        >
          <p className="font-bold">{agreement.title}</p>
          <p className="mt-1 text-sm text-neutral-700">{agreement.body}</p>
          {agreementSigned ? (
            <p className="mt-2 text-sm font-semibold text-green-800">
              Already signed for this registration.
            </p>
          ) : (
            <label className="mt-3 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span className="text-sm font-semibold">
                I agree — this is signed with my request below.
              </span>
            </label>
          )}
        </div>
      )}
      {rows.map((r) => (
        <PersonCard
          key={r.participantId}
          registrationId={registrationId}
          row={r}
          agreementReady={!needsAgreement || agreed}
          agreementKey={needsAgreement && agreed ? agreement.key : null}
        />
      ))}
    </div>
  );
}
