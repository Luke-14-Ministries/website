'use client';

// The family's "pay" control for one registration. It shows the balance and,
// on demand, lets them choose deposit / full balance / their own amount, card
// vs bank transfer, and whether to cover the processing fee -- then hands off
// to Stripe's hosted checkout. No card details are ever entered on our site.

import { useState, useTransition } from 'react';
import { createCheckout } from './pay/actions';
import { coverFeeCents, dollars } from '@/lib/payments';

export default function PayPanel({ registrationId, balanceCents, depositCents, pendingCents }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('balance'); // 'balance' | 'deposit' | 'custom'
  const [customAmount, setCustomAmount] = useState(''); // dollars, as typed
  // Bank transfer is the DEFAULT (24 Aug): its processing fee is a fraction
  // of a card's, so every family who doesn't actively prefer card leaves more
  // of their payment with the ministry.
  const [method, setMethodRaw] = useState('bank'); // 'card' | 'bank'
  // Switching TO card gets one explicit nudge -- not a block, a speed bump
  // the family steps over deliberately. Asked for in exactly these terms.
  const setMethod = (v) => {
    if (v === 'card' && method === 'bank') {
      const ok = window.confirm(
        'Cards cost the ministry more in processing fees than bank transfers do.\n\nUse a card anyway?'
      );
      if (!ok) return;
    }
    setMethodRaw(v);
  };
  const [coverFee, setCoverFee] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const balance = balanceCents ?? 0;
  const clearing = pendingCents ?? 0;

  // Nothing left to pay. Two different truths get two different badges: money
  // still clearing the bank is NOT the same as paid, and saying so avoids the
  // "it said paid, then it wasn't" conversation if a transfer ever fails.
  if (balance <= 0) {
    return clearing > 0 ? (
      <span
        className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-sm font-semibold"
        title="A bank transfer takes a few days to clear. Nothing more to do."
      >
        Paid — {dollars(clearing)} clearing the bank ⏳
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-3 py-1 text-sm font-semibold">
        Paid in full ✓
      </span>
    );
  }

  const deposit = Math.min(depositCents ?? 0, balance);
  const hasDeposit = deposit > 0;

  // The base amount for the chosen kind, in cents. For custom, parse the typed
  // dollars; invalid input shows as $0 until it parses.
  const customCents = Math.round((parseFloat(customAmount) || 0) * 100);
  const base = kind === 'deposit' ? deposit : kind === 'custom' ? customCents : balance;
  const fee = method === 'card' && coverFee && base > 0 ? coverFeeCents(base, 'card') : 0;
  const total = base + fee;

  function go() {
    setError('');
    start(async () => {
      const res = await createCheckout({
        registrationId,
        kind,
        method,
        coverFee,
        customCents: kind === 'custom' ? customCents : undefined,
      });
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
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary !py-2">
          Pay {dollars(balance)}
        </button>
        {clearing > 0 && (
          <span className="text-sm text-amber-700">{dollars(clearing)} clearing the bank ⏳</span>
        )}
      </div>
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
      <div className="flex flex-wrap gap-2 mb-2">
        <Radio name="kind" value="balance" cur={kind} set={setKind}>
          Full balance — {dollars(balance)}
        </Radio>
        {hasDeposit && (
          <Radio name="kind" value="deposit" cur={kind} set={setKind}>
            Deposit — {dollars(deposit)}
          </Radio>
        )}
        <Radio name="kind" value="custom" cur={kind} set={setKind}>
          Other amount…
        </Radio>
      </div>
      {kind === 'custom' && (
        <div className="mb-3">
          <label className="sr-only" htmlFor="custom-amt">
            Amount in dollars
          </label>
          <div className="flex items-center gap-2">
            <span className="text-neutral-500">$</span>
            <input
              id="custom-amt"
              inputMode="decimal"
              placeholder="0.00"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="w-32 rounded border border-neutral-300 px-3 py-1.5 text-sm"
              autoFocus
            />
            <span className="text-xs text-neutral-500">
              at least $1.00, up to {dollars(balance)}
            </span>
          </div>
        </div>
      )}

      <p className="text-xs font-semibold text-neutral-500 mb-1">Method</p>
      <div className="flex gap-2 mb-3">
        <Radio name="method" value="bank" cur={method} set={setMethod}>
          <span className="block">Bank transfer</span>
          <span className="block text-xs text-neutral-500 mt-0.5">
            Lower processing fee — more of your payment reaches the ministry
          </span>
        </Radio>
        <Radio name="method" value="card" cur={method} set={setMethod}>
          <span className="block">Card</span>
          <span className="block text-xs text-neutral-500 mt-0.5">Instant confirmation</span>
        </Radio>
      </div>

      {/* Offered for CARD only (24 Aug): choosing bank transfer already is
          the saving, and stacking a second ask on top of the better choice
          read as nickel-and-diming. */}
      {method === 'card' && (
        <label className="flex items-start gap-2 text-sm mb-3">
          <input
            type="checkbox"
            checked={coverFee}
            onChange={(e) => setCoverFee(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Add {dollars(base > 0 ? coverFeeCents(base, 'card') : 0)} to cover the processing
            fee, so the full amount reaches the ministry.{' '}
            <span className="text-neutral-500">(optional)</span>
          </span>
        </label>
      )}

      {method === 'bank' && (
        <p className="text-xs text-neutral-500 mb-3">
          Bank transfers take a few days to clear, so your payment will show as
          &ldquo;clearing&rdquo; until it settles.
        </p>
      )}

      {error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={go}
          disabled={pending || (kind === 'custom' && customCents < 100)}
          className="btn-primary !py-2"
        >
          {pending ? 'Starting…' : `Continue — ${dollars(total)}`}
        </button>
        <button onClick={() => setOpen(false)} disabled={pending} className="btn-outline !py-2">
          Cancel
        </button>
      </div>
      {/* The payment-by-check terms used to be one of the agreements every
          family signed at registration. They are instructions, not
          obligations, so they live here now (24 Aug) -- shown to the people
          who need them, at the moment they need them, signed by nobody. */}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-brand underline">
          Prefer to mail a check?
        </summary>
        <div className="mt-2 rounded border border-neutral-200 bg-white p-3 text-neutral-700">
          <p>
            Make it payable to <strong>Luke 14 Ministries</strong> and mail it to:
          </p>
          <p className="mt-1 font-semibold">
            Luke 14 Ministries
            <br />
            2348 W. Andrew Johnson Hwy, #140
            <br />
            Morristown, TN 37814
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Please put the family name and event in the memo line. Staff record the
            check when it arrives, and your balance here updates then.
          </p>
        </div>
      </details>

      <p className="mt-3 text-xs text-neutral-400">
        Payments are handled securely by Stripe. Card details never touch this site.
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Registration payments for camp and other ministry events cover event costs (food,
        lodging, and activities) and are <strong>not tax-deductible</strong>.
      </p>
    </div>
  );
}
