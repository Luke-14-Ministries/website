// Stripe webhook: the source of truth for "paid".
//
// Stripe calls this when a checkout completes (and again, later, when a bank
// transfer finally settles or fails). It verifies Stripe's signature, then
// writes the payment into public.payments using the Supabase service-role key
// -- which is exactly why this is an Edge Function inside Supabase and not a
// route in the website: that key must never live in the public app. The
// payments RLS is written to expect this (card/bank rows come from here), and
// migration 0006 grants service_role the DML this write needs.
//
// Idempotent: rows are upserted on stripe_payment_intent_id (unique index in
// migration 0005), so Stripe's retries can't record a payment twice.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'jsr:@supabase/supabase-js@2';

function fail(where: string, message: string, status: number) {
  console.error(`[stripe-webhook] ${where}: ${message}`);
  return new Response(`${where}: ${message}`, { status });
}

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey) return fail('config', 'STRIPE_SECRET_KEY is not set', 500);
  if (!webhookSecret) return fail('config', 'STRIPE_WEBHOOK_SECRET is not set', 500);

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

  const HANDLED = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
  ]);
  if (!HANDLED.has(event.type)) {
    return new Response('ignored', { status: 200 });
  }

  try {
    const s = event.data.object as Stripe.Checkout.Session;
    const md = s.metadata ?? {};
    const registrationId = md.registration_id;
    const base = parseInt(md.base_cents ?? '0', 10);
    const method = md.method === 'bank' ? 'bank_transfer' : 'card';
    const paymentIntentId =
      typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;

    if (!registrationId || !paymentIntentId || !(base > 0)) {
      console.log(
        `[stripe-webhook] nothing to record (registration=${registrationId}, intent=${paymentIntentId}, base=${base})`
      );
      return new Response('nothing to record', { status: 200 });
    }

    const today = new Date().toISOString().slice(0, 10);
    let status = 'processing';
    let received_on: string | null = null;
    if (event.type === 'checkout.session.async_payment_failed') {
      status = 'failed';
    } else if (s.payment_status === 'paid') {
      status = 'succeeded';
      received_on = today;
    }

    const feeCover = parseInt(md.fee_cents ?? '0', 10) || 0;
    const note =
      feeCover > 0
        ? `Paid online (${md.kind}); payer added ${(feeCover / 100).toFixed(2)} to cover the processing fee.`
        : `Paid online (${md.kind}).`;

    const { error } = await admin.from('payments').upsert(
      {
        registration_id: registrationId,
        amount_cents: base,
        fee_cover_cents: feeCover,
        method,
        status,
        received_on,
        stripe_payment_intent_id: paymentIntentId,
        note,
      },
      { onConflict: 'stripe_payment_intent_id' }
    );
    if (error) return fail('db-upsert', error.message, 500);

    console.log(
      `[stripe-webhook] recorded ${status} ${method} payment of ${base}¢ for registration ${registrationId}`
    );
    return new Response('ok', { status: 200 });
  } catch (e) {
    return fail('handler', String((e as Error)?.message ?? e), 500);
  }
});
