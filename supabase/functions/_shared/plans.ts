// Payment plans: what the Stripe webhook and the daily charger both do.
//
// One module so the two can never disagree about what a successful or failed
// charge means. Everything here is IDEMPOTENT -- Stripe retries webhooks, the
// charger and the webhook can both see the same PaymentIntent, and each
// transition happens once because every update is conditional on the row
// still being in the state it expects. An email is sent only by whoever
// actually made the transition, so a family never gets the same notice twice.
//
// Rules (Larry, 30 Sep 2026; migration 0080):
//   * the deposit is the plan's first payment and is what activates it
//   * each later charge = what is still owed / charges left, the last one
//     taking whatever remains, so the plan ends on exactly $0
//   * a failed charge is tried again 3 days later, 3 tries in all; after the
//     third the plan stops as 'failed' and staff are told
//   * staff decide whether a failed or cancelled plan keeps the early discount

import Stripe from 'npm:stripe';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MAX_ATTEMPTS = 3;
export const RETRY_DAYS = 3;
export const SITE = 'https://luke14-ministries.vercel.app';

// The ministry's calendar day (Morristown), YYYY-MM-DD.
export function ministryToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

// "Visa ending 4242" / "Bank account ending 6789" -- shown on pages so nobody
// has to ask Stripe what a plan will charge.
export function methodLabel(pm: Stripe.PaymentMethod | null): string | null {
  if (!pm) return null;
  if (pm.type === 'card' && pm.card) {
    const brand = pm.card.brand ? pm.card.brand[0].toUpperCase() + pm.card.brand.slice(1) : 'Card';
    return `${brand} ending ${pm.card.last4}`;
  }
  if (pm.type === 'us_bank_account' && pm.us_bank_account) {
    return `${pm.us_bank_account.bank_name ?? 'Bank account'} ending ${pm.us_bank_account.last4}`;
  }
  return pm.type;
}

// ---------------------------------------------------------------------------
// Email. Fire-and-tolerate: a failed email never fails a money write.
// ---------------------------------------------------------------------------

function shell(title: string, body: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <div style="background:#14606a;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Luke 14 Ministries</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:.85">${title}</p>
  </div>
  <div style="border:1px solid #dde3e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;font-size:14px">
    ${body}
    <p style="font-size:12px;color:#888">Registration payments cover event costs and are not tax-deductible. Questions? Email <a href="mailto:registration@luke14ministries.net" style="color:#14606a">registration@luke14ministries.net</a> or call (423) 748-4954.</p>
  </div>
</div>`;
}

export async function sendEmail(to: string | null, subject: string, title: string, body: string) {
  try {
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key || !to) return;
    const from =
      Deno.env.get('RECEIPT_FROM') ?? 'Luke 14 Ministries <registration@luke14ministries.net>';
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html: shell(title, body) }),
    });
    if (!resp.ok) console.error(`[plans] email failed: ${await resp.text()}`);
  } catch (e) {
    console.error(`[plans] email error: ${String((e as Error)?.message ?? e)}`);
  }
}

// Staff are told at the shared registration mailbox (override: STAFF_ALERT_TO).
export async function alertStaff(subject: string, body: string) {
  const to = Deno.env.get('STAFF_ALERT_TO') ?? 'registration@luke14ministries.net';
  await sendEmail(to, `[Payment plans] ${subject}`, 'Payment plan alert', body);
}

// ---------------------------------------------------------------------------
// Activating a plan from its deposit (webhook, kind = plan_deposit)
// ---------------------------------------------------------------------------

export async function activatePlanFromDeposit(
  admin: SupabaseClient,
  stripe: Stripe,
  s: Stripe.Checkout.Session,
  depositStatus: 'processing' | 'succeeded' | 'failed'
) {
  const md = s.metadata ?? {};
  const registrationId = md.registration_id;
  const piId = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;

  const { data: existing } = await admin
    .from('payment_plans')
    .select('id, status, activated_at, deposit_payment_intent_id')
    .eq('registration_id', registrationId)
    .maybeSingle();

  if (depositStatus === 'failed') {
    // A bank-transfer deposit that bounced (it arrived as 'processing', so the
    // plan was activated). The plan never really started: undo it completely
    // -- back to 'pending' with no activation, no schedule -- so it neither
    // keeps the early discount nor counts as "finished", and the family can
    // start again from "choose how to pay". Found in review, 30 Sep.
    // Only the deposit that activated THIS plan can undo it; a bounce from a
    // second checkout the family opened in another tab cannot.
    if (existing && existing.activated_at && existing.deposit_payment_intent_id === piId) {
      await admin
        .from('payment_plans')
        .update({ status: 'pending', activated_at: null })
        .eq('id', existing.id);
      await admin
        .from('payment_installments')
        .update({ status: 'cancelled' })
        .eq('payment_plan_id', existing.id)
        .in('status', ['scheduled', 'failed']);
      await admin.rpc('recalc_early_registration_discount', { p_registration_id: registrationId });
      await alertStaff(
        'A payment-plan deposit failed',
        `<p>The deposit for registration <code>${registrationId}</code> (${md.event_name ?? ''}) did not clear, so its payment plan was undone. The registration shows as not finished until the family chooses again.</p>`
      );
    }
    return;
  }

  // Already active (Stripe sends completed, then async_payment_succeeded for
  // a bank transfer): nothing to do. The schedule is built once.
  if (existing?.activated_at) return;

  let pmId: string | null = null;
  let pm: Stripe.PaymentMethod | null = null;
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
    pm = (typeof pi.payment_method === 'object' ? pi.payment_method : null) as Stripe.PaymentMethod | null;
    pmId = pm?.id ?? (typeof pi.payment_method === 'string' ? pi.payment_method : null);
  }

  const row = {
    registration_id: registrationId,
    schedule: md.plan_schedule === 'semi_monthly' ? 'semi_monthly' : 'monthly',
    status: 'active',
    stripe_customer_id: customerId,
    stripe_payment_method_id: pmId,
    payment_method_kind: pm?.type === 'us_bank_account' ? 'us_bank_account' : 'card',
    payment_method_label: methodLabel(pm),
    consent_text: md.consent_text ?? null,
    consented_by: md.consented_by || null,
    consented_at: md.consented_at || new Date().toISOString(),
    activated_at: new Date().toISOString(),
    deposit_payment_intent_id: piId ?? null,
    note: `Started online (${md.consent_version ?? 'consent'}).`,
  };
  const { data: plan, error } = await admin
    .from('payment_plans')
    .upsert(row, { onConflict: 'registration_id' })
    .select('id')
    .single();
  if (error) throw new Error(`plan-upsert: ${error.message}`);

  const { error: bErr } = await admin.rpc('build_plan_installments', {
    p_plan_id: plan.id,
    p_today: ministryToday(),
  });
  if (bErr) throw new Error(`build-installments: ${bErr.message}`);
  console.log(`[plans] plan ${plan.id} active for registration ${registrationId}`);
}

// ---------------------------------------------------------------------------
// A new card / bank account (webhook, setup-mode checkout, kind = plan_method_update)
// ---------------------------------------------------------------------------

export async function applyNewPaymentMethod(
  admin: SupabaseClient,
  stripe: Stripe,
  s: Stripe.Checkout.Session
) {
  const md = s.metadata ?? {};
  const siId = typeof s.setup_intent === 'string' ? s.setup_intent : s.setup_intent?.id;
  if (!siId || !md.plan_id) return;
  const si = await stripe.setupIntents.retrieve(siId, { expand: ['payment_method'] });
  const pm = (typeof si.payment_method === 'object' ? si.payment_method : null) as Stripe.PaymentMethod | null;
  if (!pm) return;

  const { data: plan } = await admin
    .from('payment_plans')
    .select('id, status')
    .eq('id', md.plan_id)
    .maybeSingle();
  if (!plan) return;

  const update: Record<string, unknown> = {
    stripe_payment_method_id: pm.id,
    payment_method_kind: pm.type === 'us_bank_account' ? 'us_bank_account' : 'card',
    payment_method_label: methodLabel(pm),
  };
  // A plan that stopped on failures starts again with the new method: its
  // failed charges get a fresh set of tries, starting tomorrow morning.
  if (plan.status === 'failed') update.status = 'active';
  await admin.from('payment_plans').update(update).eq('id', plan.id);
  if (plan.status === 'failed') {
    await admin
      .from('payment_installments')
      .update({ attempts: 0, next_attempt_on: ministryToday() })
      .eq('payment_plan_id', plan.id)
      .eq('status', 'failed');
  }
  console.log(`[plans] plan ${plan.id} payment method updated`);
}

// What is owed once money still clearing the bank is set aside. The balance
// view counts 'processing' payments as paid (right for what the family sees),
// but a plan must not be closed on money that might still bounce.
export async function settledBalance(admin: SupabaseClient, registrationId: string) {
  const [{ data: bal }, { data: clearing }] = await Promise.all([
    admin.from('registration_balances').select('balance_cents').eq('registration_id', registrationId).maybeSingle(),
    admin.from('payments').select('amount_cents').eq('registration_id', registrationId).eq('status', 'processing'),
  ]);
  const inFlight = (clearing ?? []).reduce((t: number, p: { amount_cents: number }) => t + (p.amount_cents ?? 0), 0);
  return { owed: bal?.balance_cents ?? 0, settled: (bal?.balance_cents ?? 0) + inFlight, inFlight };
}

// ---------------------------------------------------------------------------
// The outcome of one automatic charge (charger AND webhook)
// ---------------------------------------------------------------------------

export type Outcome = 'processing' | 'succeeded' | 'failed';

export async function recordInstallmentOutcome(
  admin: SupabaseClient,
  args: {
    installmentId: string;
    registrationId: string;
    piId: string;
    amountCents: number;
    method: 'card' | 'bank_transfer';
    outcome: Outcome;
    error?: string | null;
    payerEmail?: string | null;
    eventName?: string | null;
    // The charger passes its own "today" so a run and its retry dates agree.
    today?: string;
    // Which try this PaymentIntent was (its metadata.attempt). An installment
    // with no PaymentIntent tied yet is only claimed by the CURRENT try, never
    // by a late Stripe retry of an earlier one.
    attempt?: number;
  }
) {
  const today = args.today ?? ministryToday();

  // The payment row, keyed on the PaymentIntent (unique, 0005), so Stripe's
  // retries and the charger's own write land on the same row.
  const { error: payErr } = await admin.from('payments').upsert(
    {
      registration_id: args.registrationId,
      installment_id: args.installmentId,
      amount_cents: args.amountCents,
      method: args.method,
      status: args.outcome,
      received_on: args.outcome === 'succeeded' ? today : null,
      stripe_payment_intent_id: args.piId,
      payer_email: args.payerEmail ?? null,
      note: 'Payment plan — automatic payment.',
    },
    { onConflict: 'stripe_payment_intent_id' }
  );
  if (payErr) throw new Error(`payment-upsert: ${payErr.message}`);

  const { data: inst } = await admin
    .from('payment_installments')
    .select('id, status, attempts, payment_plan_id, due_on')
    .eq('id', args.installmentId)
    .maybeSingle();
  if (!inst) return;

  const newStatus = args.outcome === 'succeeded' ? 'paid' : args.outcome === 'processing' ? 'processing' : 'failed';

  // Conditional transition: only if this installment is tied to THIS
  // PaymentIntent -- or to none yet, which is the charger's state between
  // "about to charge" and "charged" (so if the charger dies in that gap, the
  // webhook still claims the installment and tomorrow's run cannot charge it
  // again) -- and not already in the new state. `moved` is false for the
  // second of two writers, charger and webhook, which then sends nothing.
  //
  // Two plain updates rather than one .or() filter: PostgREST rejects an
  // or= filter on an UPDATE (42703, found in testing 30 Sep).
  const retryOn = addDays(today, RETRY_DAYS);
  const change = {
    status: newStatus,
    stripe_payment_intent_id: args.piId,
    amount_cents: args.amountCents,
    last_error: args.outcome === 'failed' ? args.error ?? 'Payment failed' : null,
    next_attempt_on: args.outcome === 'failed' ? retryOn : null,
  };
  let transitioned = false;
  for (const tie of ['this', 'none'] as const) {
    if (tie === 'none' && (args.attempt == null || args.attempt !== inst.attempts)) continue;
    let q = admin.from('payment_installments').update(change).eq('id', inst.id).neq('status', newStatus);
    q = tie === 'this' ? q.eq('stripe_payment_intent_id', args.piId) : q.is('stripe_payment_intent_id', null);
    const { data: moved, error: moveErr } = await q.select('id');
    if (moveErr) throw new Error(`installment-update: ${moveErr.message}`);
    if ((moved ?? []).length > 0) {
      transitioned = true;
      break;
    }
  }

  await admin.rpc('recalc_early_registration_discount', { p_registration_id: args.registrationId });
  if (!transitioned) return;

  const { data: plan } = await admin
    .from('payment_plans')
    .select('id, status, payment_method_label')
    .eq('id', inst.payment_plan_id)
    .maybeSingle();
  const eventName = args.eventName ?? 'Camp registration';

  if (args.outcome === 'succeeded') {
    await sendEmail(
      args.payerEmail ?? null,
      `Receipt: ${dollars(args.amountCents)} received — ${eventName}`,
      'Payment received — thank you!',
      `<p>Your scheduled payment of <strong>${dollars(args.amountCents)}</strong> for ${eventName} was received on ${today}${plan?.payment_method_label ? ` (${plan.payment_method_label})` : ''}.</p>
       <p>Your remaining schedule is on your <a href="${SITE}/account/dashboard/" style="color:#14606a">family dashboard</a>.</p>`
    );
    // Done? Cancel what is left and close the plan -- but only on SETTLED
    // money, never on a bank transfer that is still clearing.
    const { settled } = await settledBalance(admin, args.registrationId);
    if (settled <= 0 && plan) {
      await admin
        .from('payment_installments')
        .update({ status: 'cancelled' })
        .eq('payment_plan_id', plan.id)
        .in('status', ['scheduled', 'failed']);
      await admin.from('payment_plans').update({ status: 'completed' }).eq('id', plan.id);
    }
    return;
  }

  if (args.outcome === 'failed') {
    // A clearing bank payment that bounced after the plan was closed on it
    // (or after staff completed it): reopen, so it is retried, and say so.
    if (plan && plan.status === 'completed') {
      await admin.from('payment_plans').update({ status: 'active' }).eq('id', plan.id);
      plan.status = 'active';
      await alertStaff(
        'A completed plan was reopened',
        `<p>A payment of ${dollars(args.amountCents)} on registration <code>${args.registrationId}</code> (${eventName}) failed after the plan had closed, so the plan was reopened and will retry.</p>`
      );
    }
    const outOfTries = (inst.attempts ?? 0) >= MAX_ATTEMPTS;
    if (outOfTries && plan && plan.status === 'active') {
      await admin.from('payment_plans').update({ status: 'failed' }).eq('id', plan.id);
      await alertStaff(
        `A plan stopped after ${MAX_ATTEMPTS} failed payments`,
        `<p>The payment plan for registration <code>${args.registrationId}</code> (${eventName}) could not collect ${dollars(args.amountCents)} after ${MAX_ATTEMPTS} tries. Last error: ${args.error ?? 'unknown'}.</p>
         <p>The plan is stopped. On the registration page you can retry, pause or cancel it, and decide whether the family keeps the early-registration discount.</p>`
      );
    }
    await sendEmail(
      args.payerEmail ?? null,
      `Payment problem — ${eventName}`,
      'We could not take your scheduled payment',
      `<p>Your scheduled payment of <strong>${dollars(args.amountCents)}</strong> for ${eventName} did not go through${args.error ? ` (${args.error})` : ''}.</p>
       ${outOfTries
         ? `<p>We have tried ${MAX_ATTEMPTS} times, so your payment plan is paused and camp staff will be in touch.</p>`
         : `<p>We will try again on ${retryOn}. To use a different card or bank account, open your <a href="${SITE}/account/dashboard/" style="color:#14606a">family dashboard</a> and choose &ldquo;Change card or bank account&rdquo;.</p>`}`
    );
  }
}
