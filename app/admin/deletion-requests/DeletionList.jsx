'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { settleDeletionRequest } from './actions';

const SCOPE = { medical: 'Medical information', account_and_medical: 'Account and medical information' };

function Row({ r }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const go = (status) =>
    start(async () => {
      const res = await settleDeletionRequest({ requestId: r.id, status, staffNote: note });
      if (!res.ok) setError(res.error);
    });
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="font-semibold">
        {r.household} · {SCOPE[r.scope]}
      </p>
      <p className="text-sm text-neutral-600">
        Requested {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        {r.email && ` · ${r.email}`}
        {r.phone && ` · ${r.phone}`}
      </p>
      {r.familyNote && <p className="mt-2 text-sm italic">&ldquo;{r.familyNote}&rdquo;</p>}
      {r.status === 'requested' ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="What was deleted, and what is kept and why. The family sees this."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary !py-1.5" disabled={pending} onClick={() => go('done')}>
              Mark done
            </button>
            <button type="button" className="btn-outline !py-1.5" disabled={pending} onClick={() => go('declined')}>
              Close without deleting
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-700">
          {r.status === 'done' ? 'Done' : 'Closed'}: {r.staffNote}
        </p>
      )}
      <p className="mt-2 text-xs">
        <Link href="/admin/accounts" className="text-brand underline">
          Find the account
        </Link>
      </p>
    </li>
  );
}

export default function DeletionList({ rows }) {
  if (rows.length === 0) return <p className="text-neutral-600">Nothing here.</p>;
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  );
}
