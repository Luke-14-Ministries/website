'use client';

// The family's "pay" control for one registration. It shows the balance and,
// on demand, lets them choose deposit vs full, card vs bank transfer, and
// whether to cover the processing fee -- then hands off to Stripe's hosted
// checkout. No card details are ever entered on our site.

import { useState, useTransition } from 'react';
import { createCheckout } from './pay/actions';
import { coverFeeCents, dollars } from '@/lib/payments';

export default function PayPanel({ registrationId, balanceCents, depositCents }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('balance'); // 'balance' | 'deposit'
  const [method, setMethod] = useState('card'); // 'card' | 'bank'
  const [coverFee, setCoverFee] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const balance = balanceCents ?? 0;
  if (balance <= 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-3 py-1 text-sm font-semibold">
        Paid in full ✓
      </span>
    );
  }

  const deposit = Math.min(depositCents ?? 0, balance);
  const hasDeposit = deposit > 0;
  const base = kind === 'deposit' ? deposit : balance;
  const fee = coverFee ? coverFeeCents(base, method) : 0;
  const total = base + fee;

  function go() {
    setError('');
    start(async () => {
      const res = await createCheckout({ registrationId, kind, method, coverFee });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Off to Stripe's hosted checkout.
      window.location.href = res.url;
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary !py-2">
        Pay {dollars(balance)}
      </button>
    );
  }

  const Radio = ({ name, value, cur, set, children }) => (
    <label
      className={`flex-1 cursor-pointer rounded border px-3 py-2 text-sm ${
        cur === value ? 'border-brand bg-brand-light font-semibold' : 'border-neutral-300'
      }`}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={cur === value}
        onChange={() => set(value)}
      />
      {children}
    </label>
  );

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 w-full">
      <p className="font-semibold mb-3">Make a payment</p>

      <p className="text-xs font-semibold text-neutral-500 mb-1">Amount</p>
      <div className="flex gap-2 mb-3">
        <Radio name="kind" value="balance" cur={kind} set={setKind}>
          Full balance — {dollars(balance)}
        </Radio>
        {hasDeposit && (
          <Radio name="kind" value="deposit" cur={kind} set={setKind}>
            Deposit — {dollars(deposit)}
          </Radio>
        )}
      </div>

      <p className="text-xs font-semibold text-neutral-500 mb-1">Method</p>
      <div className="flex gap-2 mb-3">
        <Radio name="method" value="card" cur={method} set={setMethod}>
          Card
        </Radio>
        <Radio name="method" value="bank" cur={method} set={setMethod}>
          Bank transfer <span className="text-neutral-500">(lower fee)</span>
        </Radio>
      </div>

      <label className="flex items-start gap-2 text-sm mb-3">
        <input
          type="checkbox"
          checked={coverFee}
          onChange={(e) => setCoverFee(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Add {dollars(coverFeeCents(base, method))} to cover the processing fee, so the full
          amount reaches the ministry. <span className="text-neutral-500">(optional)</span>
        </span>
      </label>

      {method === 'bank' && (
        <p className="text-xs text-neutral-500 mb-3">
          Bank transfers take a few days to clear, so your payment will show as
          &ldquo;pending&rdquo; until it settles.
        </p>
      )}

      {error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={go} disabled={pending} className="btn-primary !py-2">
          {pending ? 'Starting…' : `Continue — ${dollars(total)}`}
        </button>
        <button onClick={() => setOpen(false)} disabled={pending} className="btn-outline !py-2">
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs text-neutral-400">
        Payments are handled securely by Stripe. Card details never touch this site.
      </p>
    </div>
  );
}
