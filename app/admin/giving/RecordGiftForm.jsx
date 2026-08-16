'use client';

// Staff form for a mailed check or cash DONATION. Online gifts record
// themselves via the Stripe webhook. Labels are kept to one line so the field
// grid stays aligned; the longer explanations live in the intro text.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualGift } from './actions';

const FUNDS = [
  'General Operating Fund',
  'Camp Celebrate',
  'Luke 14 Party',
  'The Hazelnut Movement',
  'Wheels for Kenya',
];

const inputCls = 'w-full rounded border border-neutral-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-xs font-semibold text-neutral-500 mb-1 whitespace-nowrap';

export default function RecordGiftForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [f, setF] = useState({
    donorName: '',
    email: '',
    amount: '',
    fund: FUNDS[0],
    method: 'check',
    receivedOn: '',
    note: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    setError('');
    setDone('');
    const cents = Math.round((parseFloat(f.amount) || 0) * 100);
    start(async () => {
      const res = await recordManualGift({
        donorName: f.donorName,
        email: f.email,
        amountCents: cents,
        fund: f.fund,
        method: f.method,
        receivedOn: f.receivedOn || undefined,
        note: f.note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(`Recorded a $${(cents / 100).toFixed(2)} gift (${f.method}).`);
      setF({ ...f, donorName: '', email: '', amount: '', note: '' });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <h3 className="font-bold mb-1">Record a mailed or cash gift</h3>
      <p className="text-sm text-neutral-500 mb-4">
        The donor&rsquo;s email links the gift to their giving history if they have (or later
        create) an account. Online gifts record themselves.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Donor name</label>
          <input className={inputCls} value={f.donorName} onChange={set('donorName')} />
        </div>
        <div>
          <label className={labelCls}>Donor email</label>
          <input className={inputCls} value={f.email} onChange={set('email')} />
        </div>
        <div>
          <label className={labelCls}>Amount (dollars)</label>
          <input inputMode="decimal" placeholder="0.00" value={f.amount} onChange={set('amount')} className={inputCls} required />
        </div>
        <div>
          <label className={labelCls}>Fund</label>
          <select className={inputCls} value={f.fund} onChange={set('fund')}>
            {FUNDS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
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
        <div className="sm:col-span-2">
          <label className={labelCls}>Note (check number, in memory of, etc.)</label>
          <input className={inputCls} value={f.note} onChange={set('note')} />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      {done && (
        <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>
      )}

      <button type="submit" disabled={pending} className="btn-primary !py-2 mt-4">
        {pending ? 'Recording…' : 'Record gift'}
      </button>
    </form>
  );
}
