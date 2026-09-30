// The daily payment-plan charger.
//
// Run once a day, early morning, by Supabase Cron (setup steps in
// supabase/PAYMENT-PLANS-SETUP.md). It does NOT charge anyone daily: it finds
// the plan payments that fall due today (or a failed one whose retry date is
// today) and charges only those -- at most one charge per plan per run.
//
// Why a daily check rather than Stripe subscriptions (decided 30 Sep 2026,
// DECISIONS.md): Stripe Billing adds a percentage on top of the normal fees,
// charges fixed amounts that go stale the moment a scholarship or discount
// changes the balance, and cannot do "the 1st and 15th". Here each amount is
// worked out on the day from the live balance, so the plan always ends on
// exactly $0.
//
// Protected by a shared secret (CRON_SECRET, sent as the x-cron-secret
// header), not by a Supabase JWT -- deploy with --no-verify-jwt, like the
// Stripe webhook. POST ?dry=1 lists what WOULD be charged and charges nothing.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { chargeDuePlans } from '../_shared/charger.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return json({ error: 'STRIPE_SECRET_KEY is not set' }, 500);

  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const stripe = new Stripe(stripeKey);
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  try {
    const out = await chargeDuePlans(admin, stripe, { dry });
    console.log(`[charge-payment-plans] ${out.today}${dry ? ' (dry run)' : ''}: ${out.results.length} plan(s)`);
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
