'use client';

// The tracked-changes review list: family edits grouped by household, each
// field shown old -> new, checked off one at a time or per household.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markChangesReviewed } from './actions';

const SOURCE_LABEL = {
  people: 'Person details',
  households: 'Household info',
  person_support: 'Support & medical',
  registration_participants: 'Registration',
  person_caregivers: 'Caregivers',
  person_consents: 'Permissions',
};

const FIELD_LABEL = {
  first_name: 'First name',
  last_name: 'Last name',
  preferred_name: 'Preferred name',
  date_of_birth: 'Date of birth',
  // The column kept its original name; the ministry collects "Sex" (decided
  // 21 Aug 2026, pronouns dropped) and every form says so -- the change log
  // must match the form, not the schema.
  gender: 'Sex',
  phone: 'Phone',
  email: 'Email',
  display_name: 'Family name',
  address_line1: 'Address',
  address_line2: 'Address (line 2)',
  city: 'City',
  state: 'State',
  postal_code: 'ZIP',
  home_church: 'Home church',
  camp_role: 'Role',
  disabilities: 'Disabilities / needs',
  medications: 'Medications',
  dietary_needs: 'Dietary needs',
  allergy_detail: 'Allergies',
  seizure_detail: 'Seizure plan',
  tshirt_size: 'T-shirt size',
  first_time_attending: 'First time attending',
  how_did_you_hear: 'How they heard about us',
  how_did_you_hear_from: 'Who they heard it from',
  // person_consents logs its `kind` as the field, so these two are the whole
  // vocabulary of that source table. A withdrawn photo permission is the one
  // change on this page with a deadline attached: material may already be
  // scheduled to publish.
  media: 'Photo & video permission',
  directory: 'Participant directory',
};

function Value({ v }) {
  if (v == null || v === '') return <span className="text-neutral-400 italic">empty</span>;
  if (v === 'true') return <span>yes</span>;
  if (v === 'false') return <span>no</span>;
  return <span>{v}</span>;
}

export default function ChangesList({ groups }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // Collapsed household groups (24 Aug): a busy review day makes this page
  // long, and a header you can fold away lets staff work family by family.
  // Groups start OPEN -- unreviewed changes are exactly what the page is for.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function review(key, ids) {
    setError('');
    setBusy(key);
    start(async () => {
      const res = await markChangesReviewed(ids);
      if (!res.ok) setError(res.error);
      setBusy(null);
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
        All caught up — no unreviewed family changes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.householdId ?? 'unknown'} className="rounded-lg bg-white border border-neutral-200 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
            <button
              type="button"
              onClick={() => toggleGroup(g.householdId)}
              aria-expanded={!collapsed.has(g.householdId)}
              className="flex items-center gap-2 text-left font-bold hover:text-brand"
              title={collapsed.has(g.householdId) ? 'Show changes' : 'Hide changes'}
            >
              <span
                aria-hidden
                className={`text-xs transition-transform ${collapsed.has(g.householdId) ? '' : 'rotate-90'}`}
              >
                ▶
              </span>
              {g.household}
              <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold">
                {g.changes.length} unreviewed
              </span>
            </button>
            <button
              onClick={() => review(g.householdId, g.changes.map((c) => c.id))}
              disabled={busy === g.householdId}
              className="btn-outline !py-1.5 text-sm"
            >
              {busy === g.householdId ? '…' : 'Mark all reviewed'}
            </button>
          </div>
          {!collapsed.has(g.householdId) && (
          <ul className="divide-y divide-neutral-100">
            {g.changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p>
                    {c.person && <span className="font-semibold">{c.person} · </span>}
                    <span className="font-semibold">{FIELD_LABEL[c.field] ?? c.field}</span>
                    <span className="ml-2 text-xs text-neutral-400">
                      {SOURCE_LABEL[c.source] ?? c.source}
                    </span>
                  </p>
                  <p className="mt-0.5">
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through decoration-red-300">
                      <Value v={c.oldValue} />
                    </span>
                    <span className="mx-2 text-neutral-400">→</span>
                    <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-800">
                      <Value v={c.newValue} />
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {c.when} {c.actor ? `· by ${c.actor}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => review(c.id, [c.id])}
                  disabled={busy === c.id}
                  className="rounded border border-neutral-300 px-3 py-1.5 font-semibold text-neutral-700 hover:border-brand hover:text-brand"
                >
                  {busy === c.id ? '…' : 'Reviewed ✓'}
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
      ))}
    </div>
  );
}
