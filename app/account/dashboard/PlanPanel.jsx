'use client';

// A family's payment plan on their dashboard: what is saved, what comes next,
// and a way to change the card or bank account. Changing it opens Stripe's
// own page -- no card details are ever typed into our site.

import { useState, useTransition } from 'react';
import { dollars } from '@/lib/payments';
import { formatDueDateShort } from '@/lib/events';
import { SCHEDULE_LABEL, PLAN_STATUS_LABEL } from '@/lib/plans';
import { updatePlanPaymentMethod } from '@/app/account/finish/[registrationId]/actions';

export default function PlanPanel({ registrationId, plan, installments, balanceCents }) {
  const [changing, setChanging] = useState(false);
  const [method, setMethod] = useState('bank');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const upcoming = (installments ?? []).filter((i) => ['scheduled', 'failed', 'processing'].includes(i.status));
  const next = upcoming[0];
  const failed = plan.status === 'failed' || upcoming.some((i) => i.status === 'failed');
  // The real amount is worked out on the day from the balance, so the
  // estimate shown is the balance shared across what is left.
  const left = upcoming.filter((i) => i.status !== 'processing').length;
  const each = left > 0 ? Math.ceil(Math.max(0, balanceCents ?? 0) / left) : 0;
  const canChange = ['active', 'paused', 'failed'].includes(plan.status);

  function go() {
    setError('');
    start(async () => {
      const res = await updatePlanPaymentMethod({ registrationId, method });
      if (!res.ok) return setError(res.error);
      window.location.href = res.url;
    });
  }

  return (
    <div
      className={`mt-4 rounded border px-4 py-3 text-sm ${
        failed ? 'border-red-300 bg-red-50 text-red-900' : 'border-neutral-200 bg-neutral-50'
      }`}
    >
      <p className="font-semibold">
        Payment plan · {SCHEDULE_LABEL[plan.schedule] ?? plan.schedule} ·{' '}
        {PLAN_STATUS_LABEL[plan.status] ?? plan.status}
      </p>
      {plan.payment_method_label && <p className="mt-1">Paying with {plan.payment_method_label}.</p>}
      {failed && (
        <p className="mt-1">
          A scheduled payment didn&rsquo;t go through
          {next?.last_error ? ` (${next.last_error})` : ''}.{' '}
          {plan.status === 'failed'
            ? 'The plan is paused and camp staff will be in touch. Saving a new card or bank account starts it again.'
            : next?.next_attempt_on
              ? `We'll try again on ${formatDueDateShort(next.next_attempt_on)}.`
              : ''}
        </p>
      )}
      {next && plan.status === 'active' && !failed && (
        <p className="mt-1">
          Next payment: about <strong>{dollars(each)}</strong> on {formatDueDateShort(next.due_on)}
          {left > 1 ? `, then ${left - 1} more` : ''}.
        </p>
      )}
      {upcoming.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-brand">Full schedule</summary>
          <ul className="mt-1 space-y-0.5">
            {upcoming.map((i) => (
              <li key={i.id}>
                {formatDueDateShort(i.due_on)} — about {dollars(i.status === 'processing' ? i.amount_cents : each)}
                {i.status === 'processing' ? ' (clearing the bank)' : i.status === 'failed' ? ' (failed — will retry)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canChange && !changing && (
        <button type="button" onClick={() => setChanging(true)} className="btn-outline mt-2 !py-1.5">
          Change card or bank account
        </button>
      )}
      {changing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5"
          >
            <option value="bank">Bank account</option>
            <option value="card">Card</option>
          </select>
          <button type="button" onClick={go} disabled={pending} className="btn-primary !py-1.5">
            {pending ? 'Opening…' : 'Continue to secure page'}
          </button>
          <button type="button" onClick={() => setChanging(false)} className="text-sm underline">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
