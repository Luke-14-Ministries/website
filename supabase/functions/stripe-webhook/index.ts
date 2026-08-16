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

// Today's date in the ministry's own timezone (Eastern -- Morristown, TN), not
// UTC. A gift made at 9pm on December 31st must be receipted as December 31st,
// or a donor's year-end statement is wrong. en-CA gives YYYY-MM-DD.
function ministryToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
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

    // ---- Donations take their own path: the gifts table, and a deductible
    // receipt with the 501(c)(3) acknowledgment language. ----
    if (md.gift === '1') {
      if (!paymentIntentId || !(base > 0)) {
        return new Response('nothing to record', { status: 200 });
      }
      const gToday = ministryToday();
      let gStatus = 'processing';
      let gReceived: string | null = null;
      if (event.type === 'checkout.session.async_payment_failed') {
        gStatus = 'failed';
      } else if (s.payment_status === 'paid') {
        gStatus = 'succeeded';
        gReceived = gToday;
      }
      const donorEmail = s.customer_details?.email ?? s.customer_email ?? null;
      const { error: gErr } = await admin.from('gifts').upsert(
        {
          profile_id: md.profile_id || null,
          donor_name: s.customer_details?.name ?? null,
          email: donorEmail,
          amount_cents: base,
          fund: md.fund || 'General Operating Fund',
          method,
          status: gStatus,
          received_on: gReceived,
          stripe_payment_intent_id: paymentIntentId,
          note: 'Given online.',
        },
        { onConflict: 'stripe_payment_intent_id' }
      );
      if (gErr) return fail('gift-upsert', gErr.message, 500);
      console.log(`[stripe-webhook] recorded ${gStatus} gift of ${base}¢ (${md.fund})`);

      if (gStatus !== 'failed') {
        try {
          const resendKey = Deno.env.get('RESEND_API_KEY');
          if (resendKey && donorEmail) {
            const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
            const received = gStatus === 'succeeded';
            const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <div style="background:#14606a;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Luke 14 Ministries</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:.85">${received ? 'Thank you for your gift!' : 'Your gift is on its way'}</p>
  </div>
  <div style="border:1px solid #dde3e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#555">Gift</td><td style="padding:4px 0;text-align:right;font-weight:bold">${dollars(base)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Designated to</td><td style="padding:4px 0;text-align:right">${md.fund || 'General Operating Fund'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Method</td><td style="padding:4px 0;text-align:right">${method === 'bank_transfer' ? 'Bank transfer' : 'Card'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Date</td><td style="padding:4px 0;text-align:right">${gToday}</td></tr>
    </table>
    ${received ? '' : `<p style="color:#8a6d1a;background:#fdf6e3;border:1px solid #f0e0b0;border-radius:6px;padding:10px 14px">Bank transfers take a few days to clear. A final receipt follows once it settles; nothing more is needed from you.</p>`}
    <p style="font-size:13px;color:#555">Your generosity helps families affected by disability find community and connection. Thank you.</p>
    <p style="font-size:12px;color:#888">Luke 14 Ministries is a registered 501(c)(3) tax-exempt organization (EIN 82-2389397). Your donation is tax-deductible to the extent allowed by law, and no goods or services were provided in exchange for this contribution. Please keep this receipt for your records. Questions? <a href="mailto:info@luke14ministries.net" style="color:#14606a">info@luke14ministries.net</a> · (423) 748-4954.</p>
  </div>
</div>`;
            const resp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                // Gift receipts come from giving@ -- a password-less M365
                // distribution group, so donor replies reach the giving team.
                from: 'Luke 14 Ministries <giving@luke14ministries.net>',
                to: [donorEmail],
                subject: received
                  ? `Donation receipt: ${dollars(base)} — thank you!`
                  : `Your gift of ${dollars(base)} is on its way`,
                html,
              }),
            });
            if (!resp.ok) console.error(`[stripe-webhook] gift receipt failed: ${await resp.text()}`);
            else console.log(`[stripe-webhook] gift receipt emailed to ${donorEmail}`);
          }
        } catch (e) {
          console.error(`[stripe-webhook] gift receipt error: ${String((e as Error)?.message ?? e)}`);
        }
      }
      return new Response('ok', { status: 200 });
    }
    // ---- End donations path. Event payments continue below. ----

    if (!registrationId || !paymentIntentId || !(base > 0)) {
      console.log(
        `[stripe-webhook] nothing to record (registration=${registrationId}, intent=${paymentIntentId}, base=${base})`
      );
      return new Response('nothing to record', { status: 200 });
    }

    const today = ministryToday();
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

    // Branded receipt, sent from the ministry's own address via Resend. A
    // failure here must never fail the webhook -- the payment IS recorded --
    // so this logs and moves on. No RESEND_API_KEY set = receipts quietly off.
    if (status !== 'failed') {
      try {
        const resendKey = Deno.env.get('RESEND_API_KEY');
        const to = s.customer_details?.email ?? s.customer_email;
        if (resendKey && to) {
          const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
          const eventName = md.event_name ?? 'Event registration';
          const kindLabel =
            md.kind === 'deposit' ? 'Deposit' : md.kind === 'custom' ? 'Payment' : 'Balance payment';
          const received = status === 'succeeded';
          const subject = received
            ? `Receipt: ${dollars(base)} received — ${eventName}`
            : `Payment started: ${dollars(base)} — ${eventName}`;
          const feeLine =
            feeCover > 0
              ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Added to cover processing fee</td><td style="padding:4px 0;text-align:right">${dollars(feeCover)}</td></tr>`
              : '';
          const bankNote = received
            ? ''
            : `<p style="color:#8a6d1a;background:#fdf6e3;border:1px solid #f0e0b0;border-radius:6px;padding:10px 14px">Your bank transfer is on its way. It takes a few days to clear, and will show as &ldquo;clearing the bank&rdquo; on your dashboard until it settles. Nothing more is needed from you.</p>`;
          const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <div style="background:#14606a;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:20px">Luke 14 Ministries</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:.85">${received ? 'Payment received — thank you!' : 'Payment started'}</p>
  </div>
  <div style="border:1px solid #dde3e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#555">For</td><td style="padding:4px 0;text-align:right">${eventName} — ${kindLabel}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Amount</td><td style="padding:4px 0;text-align:right;font-weight:bold">${dollars(base)}</td></tr>
      ${feeLine}
      <tr><td style="padding:4px 12px 4px 0;color:#555">Method</td><td style="padding:4px 0;text-align:right">${method === 'bank_transfer' ? 'Bank transfer' : 'Card'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555">Date</td><td style="padding:4px 0;text-align:right">${today}</td></tr>
    </table>
    ${bankNote}
    <p style="font-size:13px;color:#555">Your payments and their status are always visible on your <a href="https://luke14-ministries.vercel.app/account/dashboard/" style="color:#14606a">family dashboard</a>.</p>
    <p style="font-size:12px;color:#888">Registration payments for camp and other ministry events cover event costs (food, lodging, and activities) and are not tax-deductible. Questions? Email <a href="mailto:info@luke14ministries.net" style="color:#14606a">info@luke14ministries.net</a> or call (423) 748-4954.</p>
  </div>
</div>`;
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              // Event receipts come from camp@ -- a real, monitored M365 mailbox,
              // so a family hitting Reply reaches an actual person (registration@
              // did not exist in M365 and replies bounced).
              from: 'Luke 14 Ministries <camp@luke14ministries.net>',
              to: [to],
              subject,
              html,
            }),
          });
          if (!resp.ok) {
            console.error(`[stripe-webhook] receipt email failed: ${await resp.text()}`);
          } else {
            console.log(`[stripe-webhook] receipt emailed to ${to}`);
          }
        } else if (!resendKey) {
          console.log('[stripe-webhook] RESEND_API_KEY not set — skipping receipt email');
        }
      } catch (e) {
        console.error(`[stripe-webhook] receipt email error: ${String((e as Error)?.message ?? e)}`);
      }
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return fail('handler', String((e as Error)?.message ?? e), 500);
  }
});
