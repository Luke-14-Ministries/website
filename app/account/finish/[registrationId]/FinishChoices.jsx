'use client';

// The three ways to finish registering. Each one hands off to Stripe's hosted
// pages (no card details on our site) or to the scholarship request page.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { dollars } from '@/lib/payments';
import { formatDueDateShort } from '@/lib/events';
import { createCheckout } from '@/app/account/dashboard/pay/actions';
import { startPaymentPlan } from './actions';

// Module level, never inside the component (CLAUDE.md: a component defined in
// another's body remounts on every render).
function Choice({ value, cur, set, title, children }) {
  const on = cur === value;
  return (
    <label
      className={`block cursor-pointer rounded-lg border p-4 ${
        on ? 'border-brand bg-brand-light' : 'border-neutral-300 bg-white'
      }`}
    >
      <input type="radio" name="route" className="sr-only" checked={on} onChange={() => set(value)} />
      <span className="font-semibold">{title}</span>
      <span className="block text-sm text-neutral-600 mt-1">{children}</span>
    </label>
  );
}

function Pill({ value, cur, set, children }) {
  return (
    <label
      className={`flex-1 cursor-pointer rounded border px-3 py-2 text-sm text-center ${
        cur === value ? 'border-brand bg-brand-light font-semibold' : 'border-neutral-300'
      }`}
    >
      <input type="radio" className="sr-only" checked={cur === value} onChange={() => set(value)} />
      {children}
    </label>
  );
}

export default function FinishChoices({
  registrationId,
  balanceCents,
  payInFullCents,
  earlySavingCents,
  earlyEndsOn,
  depositCents,
  canPlan,
  preview,
  planPending,
}) {
  const [route, setRoute] = useState(canPlan ? 'plan' : 'full');
  const [schedule, setSchedule] = useState('monthly');
  // Bank first, as everywhere else on the site: its fee is a fraction of a card's.
  const [method, setMethod] = useState('bank');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const plan = preview?.[schedule];
  const early = earlySavingCents > 0;

  function go() {
    setError('');
    start(async () => {
      const res =
        route === 'full'
          ? await createCheckout({ registrationId, kind: 'balance', method, coverFee: false })
          : await startPaymentPlan({ registrationId, schedule, method, agreed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  }

  return (
    <div className="space-y-3">
      {early && (
        <p className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">
          You registered early, so you save <strong>{dollars(earlySavingCents)}</strong>
          {earlyEndsOn ? ` (early registration ends ${formatDueDateShort(earlyEndsOn)})` : ''} when you
          pay in full or set up a payment plan.
        </p>
      )}
      {planPending && (
        <p className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          A payment plan was started but the deposit didn&rsquo;t go through, so it isn&rsquo;t set up
          yet. You can try again below.
        </p>
      )}

      {canPlan && (
        <Choice value="plan" cur={route} set={setRoute} title="Set up a payment plan">
          Pay the {dollars(depositCents)} deposit now, and the rest is charged automatically to
          the card or bank account you save, ending on the due date.
        </Choice>
      )}
      <Choice
        value="full"
        cur={route}
        set={setRoute}
        title={`Pay in full now — ${dollars(payInFullCents)}`}
      >
        {early
          ? `Includes your ${dollars(earlySavingCents)} early-registration discount.`
          : 'One payment, and you are done.'}
      </Choice>
      <Choice value="scholarship" cur={route} set={setRoute} title="Request help with the fee">
        Ask for a scholarship. It will not affect anyone&rsquo;s place, and staff will be in touch.
      </Choice>

      {route !== 'scholarship' && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-3">
          {route === 'plan' && plan && (
            <>
              <p className="text-xs font-semibold text-neutral-500">How often</p>
              <div className="flex gap-2">
                <Pill value="monthly" cur={schedule} set={setSchedule}>Monthly</Pill>
                <Pill value="semi_monthly" cur={schedule} set={setSchedule}>Twice a month</Pill>
              </div>
              <div className="text-sm">
                <p>
                  Today: <strong>{dollars(depositCents)}</strong> deposit
                </p>
                <p>
                  Then{' '}
                  <strong>
                    {plan.dates.length} {plan.dates.length === 1 ? 'payment' : 'payments'} of about{' '}
                    {dollars(plan.each)}
                  </strong>
                  {plan.dates.length > 0 && (
                    <>
                      , from {formatDueDateShort(plan.dates[0])} to{' '}
                      {formatDueDateShort(plan.dates[plan.dates.length - 1])}
                    </>
                  )}
                  .
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  Each payment is worked out on the day from what you still owe, so a scholarship
                  or an extra payment makes the rest smaller.
                </p>
              </div>
            </>
          )}

          <p className="text-xs font-semibold text-neutral-500">Pay with</p>
          <div className="flex gap-2">
            <Pill value="bank" cur={method} set={setMethod}>Bank account</Pill>
            <Pill value="card" cur={method} set={setMethod}>Card</Pill>
          </div>
          {method === 'card' && (
            <p className="text-xs text-neutral-500">
              Cards cost the ministry more in processing fees than bank transfers do.
            </p>
          )}

          {route === 'plan' && plan && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{plan.consent}</span>
            </label>
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="button"
            onClick={go}
            disabled={pending || (route === 'plan' && !agreed)}
            className="btn-primary !py-2 disabled:opacity-50"
          >
            {pending
              ? 'Opening secure checkout…'
              : route === 'plan'
                ? `Pay ${dollars(depositCents)} deposit and start plan`
                : `Pay ${dollars(payInFullCents)}`}
          </button>
        </div>
      )}

      {route === 'scholarship' && (
        <Link href={`/account/scholarship/${registrationId}/`} className="btn-primary inline-block !py-2">
          Go to the scholarship request
        </Link>
      )}

      {!canPlan && balanceCents > 0 && (
        <p className="text-xs text-neutral-500">
          A payment plan needs at least a week before the balance is due, so it isn&rsquo;t offered
          for this registration.
        </p>
      )}
    </div>
  );
}
