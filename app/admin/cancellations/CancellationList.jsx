'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { settleCancellation } from './actions';

const STATUS = {
  open: ['Open', 'bg-amber-100 text-amber-800'],
  actioned: ['Cancelled', 'bg-neutral-200 text-neutral-700'],
  declined: ['Not cancelled', 'bg-neutral-200 text-neutral-700'],
  withdrawn: ['Withdrawn by family', 'bg-neutral-100 text-neutral-500'],
};

function Row({ row }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(row.staffNote);
  const [error, setError] = useState('');
  const [label, cls] = STATUS[row.status] ?? STATUS.open;

  function settle(status) {
    setError('');
    // "Actioned" is a claim that the places were released, and this screen
    // does not release them -- so it asks whether that was actually done,
    // rather than letting the queue drift out of step with the roster.
    if (status === 'actioned') {
      const ok = window.confirm(
        `Mark this handled as CANCELLED?\n\nThis records that you dealt with it. It does not release the places or refund anything — do those on the registration and the payment first if you have not already.`
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await settleCancellation({ requestId: row.id, status, staffNote: note });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">
          {row.household}
          <span className="ml-2 text-sm font-normal text-neutral-500">{row.eventName}</span>
        </h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
      </div>

      <p className="mt-1 text-sm">
        <span className="font-semibold">Cancelling:</span>{' '}
        {row.who === null ? (
          <span className="text-amber-800 font-semibold">
            the whole registration ({row.peopleCount}{' '}
            {row.peopleCount === 1 ? 'person' : 'people'})
          </span>
        ) : (
          row.who.join(', ')
        )}
      </p>

      {row.reason && (
        <p className="mt-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          &ldquo;{row.reason}&rdquo;
        </p>
      )}

      <p className="mt-2 text-xs text-neutral-500">
        Asked {(row.requestedAt ?? '').slice(0, 10)}
        {row.phone && <> · {row.phone}</>}
        {row.email && <> · {row.email}</>}
        {row.handledAt && <> · settled {row.handledAt.slice(0, 10)}</>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={`/admin/registrations/${row.registrationId}`}
          className="btn-outline !py-1.5 text-sm"
        >
          Open the registration
        </Link>
        <span className="text-xs text-neutral-500">
          — cancel the places there, and refund on the payment below them
        </span>
      </div>

      {row.status === 'open' && (
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <label className="block text-sm font-semibold mb-1" htmlFor={`note-${row.id}`}>
            What did you do? <span className="font-normal text-neutral-500">(optional)</span>
          </label>
          <input
            id={`note-${row.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Spoke to Dana; cancelled both places, refunded the deposit."
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={() => settle('actioned')}
              disabled={pending}
              className="btn-primary !py-1.5 text-sm"
            >
              {pending ? 'Saving…' : 'Handled — places cancelled'}
            </button>
            <button
              onClick={() => settle('declined')}
              disabled={pending}
              className="btn-outline !py-1.5 text-sm"
            >
              Handled — staying after all
            </button>
          </div>
        </div>
      )}

      {row.status !== 'open' && row.staffNote && (
        <p className="mt-2 text-sm text-neutral-600">
          <span className="font-semibold">Note:</span> {row.staffNote}
        </p>
      )}
    </div>
  );
}

export default function CancellationList({ rows }) {
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Row key={r.id} row={r} />
      ))}
    </div>
  );
}
