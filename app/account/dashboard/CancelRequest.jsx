'use client';

// "We can't come" — the family's way of saying so without a phone call.
//
// Kept behind a disclosure rather than sitting as a button beside Pay and
// Statement. Cancelling is rare, consequential, and not something to put one
// mis-click away from a family who came to the page to pay a deposit.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestCancellation, withdrawCancellation } from './cancel-actions';

export default function CancelRequest({ registrationId, people = [], openRequest = null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  // Empty selection means the whole registration, which is what the copy says.
  const [selected, setSelected] = useState(() => new Set());

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function send() {
    setError('');
    start(async () => {
      const res = await requestCancellation({
        registrationId,
        participantIds: [...selected],
        reason,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason('');
      setSelected(new Set());
      router.refresh();
    });
  }

  function withdraw() {
    setError('');
    start(async () => {
      const res = await withdrawCancellation({ requestId: openRequest.id });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  // A request already in flight replaces the control entirely — the family
  // should see its status, not a way to raise a second one.
  if (openRequest) {
    const who =
      (openRequest.participant_ids ?? []).length === 0
        ? 'the whole registration'
        : people
            .filter((p) => openRequest.participant_ids.includes(p.participantId))
            .map((p) => p.name)
            .join(', ') || 'selected people';
    return (
      <div className="mt-4 rounded border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm">
        <p className="font-semibold">Cancellation requested — {who}</p>
        <p className="mt-1 text-neutral-700">
          Camp staff have this and will be in touch. Nothing is cancelled yet, and any
          money already paid is unaffected until they have spoken to you.
        </p>
        {error && <p className="mt-2 text-red-700">{error}</p>}
        <button
          onClick={withdraw}
          disabled={pending}
          className="mt-2 text-sm font-semibold text-brand underline disabled:opacity-50"
        >
          {pending ? 'Working…' : 'Never mind — withdraw this request'}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-sm text-neutral-500 underline hover:text-neutral-700"
      >
        Need to cancel?
      </button>
    );
  }

  return (
    <div className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-4">
      <p className="font-semibold">Ask to cancel</p>
      <p className="mt-1 text-sm text-neutral-700">
        This sends a note to camp staff — it does <strong>not</strong> cancel anything by
        itself. They will confirm with you, and sort out anything already paid.
      </p>

      {people.length > 1 && (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold">Who is cancelling?</legend>
          <p className="text-xs text-neutral-500 mb-1">
            Leave all unticked if the whole family is cancelling.
          </p>
          <div className="space-y-1">
            {people.map((p) => (
              <label key={p.participantId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(p.participantId)}
                  onChange={() => toggle(p.participantId)}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="mt-3 block text-sm font-semibold" htmlFor={`why-${registrationId}`}>
        What has changed?
      </label>
      <textarea
        id={`why-${registrationId}`}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        placeholder="A short note is plenty. If cost is the problem, say so — the ministry would rather help than lose you."
      />

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={send} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Sending…' : 'Send request'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError('');
          }}
          disabled={pending}
          className="text-sm text-neutral-500 underline"
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
