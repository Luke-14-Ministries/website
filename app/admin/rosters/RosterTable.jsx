'use client';

// Sortable roster table. Click a heading to sort; click again to flip.
// Defaults to newest submissions first, so recent additions surface on top.

import { useMemo, useState } from 'react';

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;

const COLS = [
  { key: 'household', label: 'Household' },
  { key: 'person', label: 'Person' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'fee', label: 'Fee', right: true },
  { key: 'submitted', label: 'Submitted' },
];

export default function RosterTable({ rows }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });

  function clickHeader(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-500">
          <tr>
            {COLS.map((c) => (
              <th key={c.key} className={`px-4 py-2 font-semibold ${c.right ? 'text-right' : ''}`}>
                <button
                  onClick={() => clickHeader(c.key)}
                  className="inline-flex items-center gap-1 hover:text-neutral-800"
                  title="Sort by this column"
                >
                  {c.label}
                  {sort.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-t border-neutral-100 align-top">
              <td className="px-4 py-2">
                <a href={`/admin/registrations/${r.registrationId}`} className="font-medium text-brand underline">
                  {r.household}
                </a>
                {r.contact && <div className="text-neutral-500">{r.contact}</div>}
              </td>
              <td className="px-4 py-2">{r.person}</td>
              <td className="px-4 py-2">{ROLE_LABEL[r.role] ?? r.role}</td>
              <td className="px-4 py-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    STATUS_CLS[r.status] ?? STATUS_CLS.submitted
                  }`}
                >
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-2 text-right">{money(r.fee)}</td>
              <td className="px-4 py-2 text-neutral-600">{r.submitted ? r.submitted.slice(0, 10) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
