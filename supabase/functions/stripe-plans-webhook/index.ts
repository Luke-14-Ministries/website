// Stripe webhook for PAYMENT PLANS (0080). A second endpoint rather than more
// code in stripe-webhook, for the reason stripe-refund-webhook gives: the
// payment webhook records money and everything depends on it, so new concerns
// get their own endpoint instead of surgery on a load-bearing path.
//
// What it does, and nothing else:
//   checkout.session.completed / async_payment_succeeded / async_payment_failed
//       kind = plan_deposit       -> activate the plan, build its schedule
//                                    (stripe-webhook records the deposit
//                                    itself, exactly like any other deposit)
//       mode = setup, kind = plan_method_update
//                                 -> swap in the family's new card/bank account
//   payment_intent.succeeded / payment_intent.payment_failed
//       kind = plan_installment   -> record the automatic charge's outcome
//                                    (bank transfers settle days after the
//                                    charger made them; cards are usually
//                                    already recorded by the charger, and this
//                                    confirms without double-counting)
// Every other event, and every other kind, is acknowledged and ignored.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  activatePlanFromDeposit,
  applyNewPaymentMethod,
  recordInstallmentOutcome,
} from '../_shared/plans.ts';

function fail(where: string, message: string, status: number) {
  console.error(`[stripe-plans-webhook] ${where}: ${message}`);
  return new Response(`${where}: ${message}`, { status });
}

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_PLANS_WEBHOOK_SECRET');
  if (!stripeKey) return fail('config', 'STRIPE_SECRET_KEY is not set', 500);
  if (!webhookSecret) return fail('config', 'STRIPE_PLANS_WEBHOOK_SECRET is not set', 500);

  const stripe = new Stripe(stripeKey);
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', webhookSecret);
  } catch (e) {
    return fail('signature', (e as Error).message, 400);
  }

  try {
    // Only these three checkout events. Anything else (checkout.session.expired,
    // if it were ever subscribed) must never be read as "deposit processing".
    const CHECKOUT = new Set([
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
    ]);
    if (CHECKOUT.has(event.type)) {
      const s = event.data.object as Stripe.Checkout.Session;
      const md = s.metadata ?? {};

      if (s.mode === 'setup' && md.kind === 'plan_method_update') {
        if (event.type === 'checkout.session.completed') await applyNewPaymentMethod(admin, stripe, s);
        return new Response('ok', { status: 200 });
      }

      if (md.kind === 'plan_deposit' && md.registration_id) {
        const status =
          event.type === 'checkout.session.async_payment_failed'
            ? 'failed'
            : s.payment_status === 'paid'
              ? 'succeeded'
              : 'processing';
        await activatePlanFromDeposit(admin, stripe, s, status);
        await admin.rpc('recalc_early_registration_discount', { p_registration_id: md.registration_id });
        return new Response('ok', { status: 200 });
      }
      return new Response('ignored', { status: 200 });
    }

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = pi.metadata ?? {};
      if (md.kind !== 'plan_installment' || !md.installment_id || !md.registration_id) {
        return new Response('ignored', { status: 200 });
      }
      let payerEmail: string | null = null;
      if (typeof pi.customer === 'string') {
        const c = await stripe.customers.retrieve(pi.customer);
        payerEmail = c && !('deleted' in c && c.deleted) ? (c as Stripe.Customer).email : null;
      }
      await recordInstallmentOutcome(admin, {
        installmentId: md.installment_id,
        registrationId: md.registration_id,
        piId: pi.id,
        amountCents: parseInt(md.base_cents ?? '', 10) || pi.amount,
        method: md.method === 'bank' ? 'bank_transfer' : 'card',
        outcome: event.type === 'payment_intent.succeeded' ? 'succeeded' : 'failed',
        error: pi.last_payment_error?.message ?? null,
        payerEmail,
        eventName: md.event_name ?? null,
        attempt: md.attempt ? parseInt(md.attempt, 10) : undefined,
      });
      return new Response('ok', { status: 200 });
    }

    return new Response('ignored', { status: 200 });
  } catch (e) {
    // A 500 makes Stripe retry, and everything above is idempotent.
    return fail('handler', String((e as Error)?.message ?? e), 500);
  }
});
