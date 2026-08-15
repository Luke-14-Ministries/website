// Stripe webhook: the source of truth for "paid".
//
// Stripe calls this when a checkout completes (and again, later, when a bank
// transfer finally settles or fails). It verifies Stripe's signature, then
// writes the payment into public.payments using the Supabase service-role key
// -- which is exactly why this is an Edge Function inside Supabase and not a
// route in the website: that key must never live in the public app. The
// payments RLS is written to expect this (card/bank rows come from here).
//
// Idempotent: rows are upserted on stripe_payment_intent_id (unique index in
// migration 0005), so Stripe's retries can't record a payment twice.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', webhookSecret);
  } catch (e) {
    return new Response(`Signature verification failed: ${(e as Error).message}`, { status: 400 });
  }

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

    const note =
      md.cover_fee === '1'
        ? `Paid online (${md.kind}); family added ${md.fee_cents}¢ to cover the processing fee.`
        : `Paid online (${md.kind}).`;

    const { error } = await admin.from('payments').upsert(
      {
        registration_id: registrationId,
        amount_cents: base,
        method,
        status,
        received_on,
        stripe_payment_intent_id: paymentIntentId,
        note,
      },
      { onConflict: 'stripe_payment_intent_id' }
    );
    if (error) return new Response(error.message, { status: 500 });

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response(String((e as Error)?.message ?? e), { status: 500 });
  }
});
