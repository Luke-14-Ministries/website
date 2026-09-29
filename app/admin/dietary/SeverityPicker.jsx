'use client';

// The staff-side allergy severity control on Dietary & Allergies (29 Sep 2026).
// A plain select that saves on change. The reminder beside it is deliberately a
// NOTE and not a confirm dialog: Lawrence asked for a non-blocking warning, and
// the point is to keep the rule in front of whoever is typing, not to make them
// click through it.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAllergySeverity } from './actions';

const OPTIONS = [
  ['', 'not recorded'],
  ['mild', 'Mild'],
  ['severe', 'Severe'],
  ['anaphylaxis', 'Anaphylaxis'],
];

export default function SeverityPicker({ personId, value, name }) {
  const [current, setCurrent] = useState(value ?? '');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function onChange(e) {
    const next = e.target.value;
    setCurrent(next);
    setError('');
    start(async () => {
      const res = await setAllergySeverity({ personId, severity: next || null });
      if (!res.ok) {
        setError(res.error);
        setCurrent(value ?? '');
      } else {
        router.refresh();
      }
    });
  }

  return (
    <span className="ml-2 inline-flex flex-col gap-0.5 align-middle">
      <select
        aria-label={`Allergy severity for ${name}`}
        title="Set this only from what the family or the camp doctor has told you."
        value={current}
        onChange={onChange}
        disabled={pending}
        className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs"
      >
        {OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
