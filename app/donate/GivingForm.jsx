'use client';

// The live giving form. Hands off to Stripe's hosted checkout -- no card
// details ever touch this site. One-time gifts are live; monthly recurring
// giving is a planned addition and is shown honestly as coming soon.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createDonationCheckout } from './actions';
import { coverFeeCents, dollars } from '@/lib/payments';

const presets = [25, 50, 100, 250, 500];
const funds = [
  'General Operating Fund',
  'Camp Celebrate',
  'Luke 14 Party',
  'The Hazelnut Movement',
  'Wheels for Kenya',
];

export default function GivingForm({ signedInEmail }) {
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');
  const [fund, setFund] = useState(funds[0]);
  const [method, setMethod] = useState('card');
  const [coverFee, setCoverFee] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const effective = custom ? Number(custom) || 0 : amount;
  const baseCents = Math.round(effective * 100);
  // What covering the fee WOULD add -- always computed, so the checkbox label
  // shows the real number before the person decides, not $0.00.
  const prospectiveFee = baseCents >= 100 ? coverFeeCents(baseCents, method) : 0;
  const feeCents = coverFee ? prospectiveFee : 0;
  const totalCents = baseCents + feeCents;

  function submit(e) {
    e.preventDefault();
    setError('');
    start(async () => {
      const res = await createDonationCheckout({
        amountCents: baseCents,
        fund,
        method,
        coverFee,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow p-6 sm:p-8 bg-white"
      onSubmit={submit}
    >
      <h3 className="text-2xl font-bold mb-4">Give Online</h3>

      {/* The guest-or-account choice, made BEFORE the gift rather than
          discovered after. Guest giving stays one click away -- no pressure --
          but anyone who might want their giving history in one place gets the
          chance to log in first and come straight back here. */}
      {signedInEmail ? (
        <p className="mb-5 rounded border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Signed in as <strong>{signedInEmail}</strong> — this gift will be saved
          to your giving history and receipts.
        </p>
      ) : (
        <div className="mb-5 rounded border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          <p>
            <strong>Giving as a guest</strong> — quick and easy, with a receipt
            emailed to you.
          </p>
          <p className="mt-1.5 text-neutral-600">
            Think you might want to look back at your giving later — for
            receipts, history, or a year-end record?{' '}
            <Link href="/account/?next=/donate/" className="text-brand underline font-medium">
              Log in
            </Link>{' '}
            or{' '}
            <Link href="/account/signup/?next=/donate/" className="text-brand underline font-medium">
              create a free account
            </Link>{' '}
            first — you&rsquo;ll come right back to this page.
          </p>
        </div>
      )}

      <div className="flex rounded overflow-hidden border border-brand mb-5">
        <button type="button" className="flex-1 py-2.5 font-semibold bg-brand text-white">
          One-Time
        </button>
        <button
          type="button"
          disabled
          title="Monthly giving is coming soon"
          className="flex-1 py-2.5 font-semibold bg-white text-neutral-400 cursor-not-allowed"
        >
          Monthly <span className="text-xs">· soon</span>
        </button>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setAmount(p);
              setCustom('');
            }}
            className={`rounded border py-2.5 font-semibold ${
              !custom && amount === p
                ? 'bg-brand text-white border-brand'
                : 'border-neutral-300 hover:border-brand'
            }`}
          >
            ${p}
          </button>
        ))}
      </div>
      <input
        type="number"
        min="1"
        step="0.01"
        placeholder="Custom amount"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-5"
      />

      <label className="block font-semibold mb-1.5">Designate my gift to</label>
      <select
        value={fund}
        onChange={(e) => setFund(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-5"
      >
        {funds.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>

      <label className="block font-semibold mb-1.5">Payment method</label>
      <div className="flex gap-2 mb-4">
        {[
          ['card', 'Card', 'Instant confirmation'],
          ['bank', 'Bank transfer', 'Lower processing fee — more of your gift reaches the ministry'],
        ].map(([v, label, sub]) => (
          <label
            key={v}
            className={`flex-1 cursor-pointer rounded border px-3 py-2 text-sm text-center ${
              method === v ? 'border-brand bg-brand-light' : 'border-neutral-300'
            }`}
          >
            <input
              type="radio"
              name="gift-method"
              className="sr-only"
              checked={method === v}
              onChange={() => setMethod(v)}
            />
            <span className={`block ${method === v ? 'font-semibold' : 'font-medium'}`}>{label}</span>
            <span className="block text-xs text-neutral-500 mt-0.5">{sub}</span>
          </label>
        ))}
      </div>

      <label className="flex items-start gap-2 text-sm mb-5">
        <input
          type="checkbox"
          checked={coverFee}
          onChange={(e) => setCoverFee(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Add {dollars(prospectiveFee)} to cover processing, so my whole gift reaches the
          ministry. <span className="text-neutral-500">(optional — it all counts as part of
          your donation)</span>
        </span>
      </label>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || baseCents < 100} className="btn-gold w-full text-lg">
        {pending ? 'Starting…' : `Give ${dollars(totalCents)}`}
      </button>
      <p className="mt-3 text-sm text-neutral-500 text-center">
        Secure checkout by Stripe. Luke 14 Ministries is a registered 501(c)(3);
        donations are tax-deductible and a receipt is emailed automatically.
      </p>
    </form>
  );
}
