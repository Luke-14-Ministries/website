'use client';

// The door list: big touch targets, type-to-find, arrival counts. Flags shown
// beside a name are the ones door staff need at a glance; full detail stays on
// the sensitive-gated medical pages (and only appears here at all for staff
// who hold that permission -- RLS strips it for everyone else).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleCheckIn } from './actions';

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

export default function CheckinList({ rows }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [pendingId, setPendingId] = useState(null);
  const [, start] = useTransition();
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) || r.household.toLowerCase().includes(needle)
        )
      : rows;
    return [...list].sort((a, b) => a.sortName.localeCompare(b.sortName));
  }, [rows, q]);

  const arrived = rows.filter((r) => r.checkedInAt).length;

  function toggle(row) {
    setError('');
    setPendingId(row.id);
    start(async () => {
      const res = await toggleCheckIn(row.id, !row.checkedInAt);
      if (!res.ok) setError(res.error);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name or family…"
          className="flex-1 min-w-[14rem] rounded border border-neutral-300 px-4 py-2.5"
        />
        <span className="text-sm font-semibold text-neutral-600">
          {arrived} / {rows.length} arrived
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {filtered.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {r.name}
                <span className="font-normal text-neutral-500"> · {ROLE_LABEL[r.role] ?? r.role}</span>
              </p>
              <p className="text-sm text-neutral-500">
                {r.household}
                {r.flags.length > 0 && (
                  <span className="ml-2">
                    {r.flags.map((f) => (
                      <span
                        key={f}
                        className="mr-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-semibold"
                      >
                        {f}
                      </span>
                    ))}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => toggle(r)}
              disabled={pendingId === r.id}
              className={
                r.checkedInAt
                  ? 'rounded-lg bg-green-100 text-green-800 px-4 py-2.5 font-semibold border border-green-300'
                  : 'btn-primary !py-2.5'
              }
            >
              {pendingId === r.id
                ? '…'
                : r.checkedInAt
                  ? `Arrived ✓ ${r.checkedInAt.slice(11, 16)}`
                  : 'Check in'}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-neutral-500">No matches.</li>
        )}
      </ul>
    </div>
  );
}
