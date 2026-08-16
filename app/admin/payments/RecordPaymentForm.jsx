'use client';

// Staff form for a check or cash that arrived by mail or hand. Card and bank
// payments never come through here -- they are recorded automatically by the
// Stripe webhook.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualPayment } from './actions';

const inputCls = 'w-full rounded border border-neutral-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-xs font-semibold text-neutral-500 mb-1';

export default function RecordPaymentForm({ registrations }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [f, setF] = useState({
    registrationId: registrations[0]?.id ?? '',
    amount: '',
    method: 'check',
    receivedOn: '',
    note: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Type-to-filter for the registration picker: with a season's worth of
  // families this list gets long, so a search box narrows it as you type.
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? registrations.filter((r) => r.label.toLowerCase().includes(q.trim().toLowerCase()))
    : registrations;

  function submit(e) {
    e.preventDefault();
    setError('');
    setDone('');
    const cents = Math.round((parseFloat(f.amount) || 0) * 100);
    start(async () => {
      const res = await recordManualPayment({
        registrationId: f.registrationId,
        amountCents: cents,
        method: f.method,
        receivedOn: f.receivedOn || undefined,
        note: f.note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`Recorded $${(cents / 100).toFixed(2)} (${f.method}).`);
      setF({ ...f, amount: '', note: '' });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <h3 className="font-bold mb-1">Record a check or cash payment</h3>
      <p className="text-sm text-neutral-500 mb-4">
        For money that arrived by mail or in person. Online card and bank payments record
        themselves.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Family / registration</label>
          <input
            value={q}
            onChange={(e) => {
              const next = e.target.value;
              setQ(next);
              // If the current pick falls out of the filtered list, snap to the
              // first match so the select never shows something un-chosen.
              const list = next.trim()
                ? registrations.filter((r) => r.label.toLowerCase().includes(next.trim().toLowerCase()))
                : registrations;
              if (!list.some((r) => r.id === f.registrationId)) {
                setF((prev) => ({ ...prev, registrationId: list[0]?.id ?? '' }));
              }
            }}
            placeholder="Type to filter by family or week…"
            className={`${inputCls} mb-1.5`}
          />
          <select className={inputCls} value={f.registrationId} onChange={set('registrationId')}>
            {filtered.length === 0 && <option value="">No matches — clear the filter above</option>}
            {filtered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount (dollars)</label>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={f.amount}
            onChange={set('amount')}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Method</label>
          <select className={inputCls} value={f.method} onChange={set('method')}>
            <option value="check">Check</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Date received (blank = today)</label>
          <input type="date" className={inputCls} value={f.receivedOn} onChange={set('receivedOn')} />
        </div>
        <div>
          <label className={labelCls}>Note (check number, etc.)</label>
          <input className={inputCls} value={f.note} onChange={set('note')} />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {done}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary !py-2 mt-4">
        {pending ? 'Recording…' : 'Record payment'}
      </button>
    </form>
  );
}
