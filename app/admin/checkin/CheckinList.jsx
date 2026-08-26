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
            <div className="flex min-w-0 items-center gap-3">
              {/* Absent until a family uploads one, so the layout still has to
                  look right with no photo at all. */}
              {r.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.photoUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover border border-neutral-200"
                />
              )}
              <div className="min-w-0">
              <p className="font-semibold">
                {r.name}
                <span className="font-normal text-neutral-500"> · {ROLE_LABEL[r.role] ?? r.role}</span>
                {/* Deliberately beside the NAME rather than among the red
                    medical flags below: it is a rule to follow, not an alert,
                    and it must stay visible to door staff who don't hold the
                    sensitive grant and therefore see no medical flags at all. */}
                {r.noPhoto && (
                  <span
                    className="ml-2 rounded-full bg-neutral-800 text-white px-2 py-0.5 text-xs font-semibold align-middle"
                    title="This family asked us not to feature them in published photos or video. Not a promise they never appear in a wide group shot."
                  >
                    no photos
                  </span>
                )}
              </p>
              <p className="text-sm text-neutral-500">
                {/* The gray line is the household -- worth saying, because in
                    testing it read as a mystery second name. */}
                <span title="Household">{r.household}</span>
                {r.flags.length > 0 && (
                  <span className="ml-2">
                    {r.flags.map((f) => (
                      <span
                        key={f.t}
                        title={f.title}
                        /* red = ignoring it harms someone or breaks a
                           promise; amber = work outstanding; neutral = a
                           settled fact worth seeing (an assigned buddy). */
                        className={`mr-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          f.tone === 'amber'
                            ? 'bg-amber-100 text-amber-800'
                            : f.tone === 'neutral'
                              ? 'bg-neutral-100 text-neutral-600'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {f.t}
                      </span>
                    ))}
                  </span>
                )}
              </p>
              </div>
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
              {/* Time AND date (25 Aug). A camp week runs several days and
                  people arrive across them — "Arrived ✓ 4:12 PM" on the
                  Thursday of a Monday-to-Friday week does not say which day,
                  and that is exactly the question asked when someone is
                  looking for a person. The date is smaller because the time is
                  what is usually wanted; the day is what is occasionally
                  needed. */}
              {pendingId === r.id ? (
                '…'
              ) : r.checkedInAt ? (
                <span className="flex flex-col items-center leading-tight">
                  <span>
                    Arrived ✓{' '}
                    {new Date(r.checkedInAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-xs font-normal opacity-75">
                    {new Date(r.checkedInAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </span>
              ) : (
                'Check in'
              )}
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
