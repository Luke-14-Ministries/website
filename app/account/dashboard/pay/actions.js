'use server';

// Creates a Stripe Checkout Session for a family paying a deposit or a balance.
//
// The amount is computed HERE, on the server, from registration_balances (which
// runs under the family's own row-level security) -- never taken from the
// browser. Stripe is handed one settled figure. The webhook (a Supabase Edge
// Function) is what actually records the payment once the money moves; this only
// starts the checkout.

import { headers } from 'next/headers';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/server';
import { coverFeeCents, registrationDepositCents } from '@/lib/payments';

export async function createCheckout({ registrationId, kind, method, coverFee, customCents }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };

  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: 'Online payment is not switched on yet. Please check back soon.' };
  }
  if (method !== 'card' && method !== 'bank') {
    return { ok: false, error: 'Please choose a payment method.' };
  }
  if (kind !== 'deposit' && kind !== 'balance' && kind !== 'custom') {
    return { ok: false, error: 'Please choose what to pay.' };
  }

  const supabase = await createClient();

  // What is owed, scoped to this family by RLS on the underlying tables.
  const { data: bal } = await supabase
    .from('registration_balances')
    .select('balance_cents, event_id')
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (!bal) return { ok: false, error: 'We could not find that registration.' };

  const balance = bal.balance_cents ?? 0;
  if (balance <= 0) return { ok: false, error: 'This registration is already paid in full.' };

  const { data: ev } = await supabase
    .from('events')
    .select('name, deposit_cents')
    .eq('id', bal.event_id)
    .maybeSingle();

  let base;
  if (kind === 'deposit') {
    // PER PERSON, the same figure the dashboard banner and PayPanel show.
    //
    // Found 29 Sep 2026 (Testing Script 3 §12.2): the 31 Aug per-person
    // correction reached every display of the deposit but not this action,
    // so the panel said "$150 — $50 for each of the 3 people" and Stripe
    // Checkout opened at $50. A family paying "the deposit" would have been
    // $100 short with nothing on screen to say so. Same helper, same rows.
    const { data: parts } = await supabase
      .from('registration_participants')
      .select('id, person_id, status')
      .eq('registration_id', registrationId);
    const deposit = registrationDepositCents({
      perPersonCents: ev?.deposit_cents,
      participants: parts,
      balanceCents: balance,
    });
    if (deposit <= 0) return { ok: false, error: 'No deposit amount is set for this camp yet.' };
    base = deposit;
  } else if (kind === 'custom') {
    // A whole number of cents, validated HERE -- never trusted from the browser
    // beyond being the family's chosen figure. At least $1, never more than the
    // remaining balance.
    const amt = Math.round(Number(customCents));
    if (!Number.isFinite(amt) || amt < 100) {
      return { ok: false, error: 'Please enter an amount of at least $1.00.' };
    }
    if (amt > balance) {
      return {
        ok: false,
        error: `That is more than the remaining balance. The most you can pay is $${(balance / 100).toFixed(2)}.`,
      };
    }
    base = amt;
  } else {
    // Paying everything now: the balance less any early-registration discount
    // that paying in full earns (0080). Charging the undiscounted balance and
    // letting the discount turn it into a credit would mean a refund for
    // every early family who pays in one go.
    const { data: full, error: fullErr } = await supabase.rpc('pay_in_full_amount', {
      p_registration_id: registrationId,
    });
    if (fullErr) console.error('pay_in_full_amount:', fullErr.message);
    base = Math.min(balance, fullErr || full == null ? balance : full);
    if (base <= 0) return { ok: false, error: 'This registration is already paid in full.' };
  }

  const fee = coverFee ? coverFeeCents(base, method) : 0;
  const charge = base + fee;
  const KIND_LABEL = { deposit: 'Deposit', balance: 'Balance', custom: 'Payment' };
  const label = `${ev?.name ?? 'Camp registration'} — ${KIND_LABEL[kind]}`;

  // Build the return URLs from the request's own host, so this works the same
  // on the production domain and on any preview deployment.
  const h = await headers();
  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  const origin = host ? `${proto}://${host}` : '';

  // The metadata travels with the payment and is what the webhook reads to
  // record it against the right registration. base_cents (not the grossed-up
  // charge) is what counts toward the balance; the fee is extra to offset
  // Stripe's cut.
  const metadata = {
    registration_id: registrationId,
    base_cents: String(base),
    fee_cents: String(fee),
    method,
    kind,
    cover_fee: coverFee ? '1' : '0',
    // Travels to the webhook so the emailed receipt can say what was paid for
    // without another database lookup.
    event_name: ev?.name ?? 'Camp registration',
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: method === 'bank' ? ['us_bank_account'] : ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: charge,
            product_data: { name: label },
          },
        },
      ],
      customer_email: user.email,
      success_url: `${origin}/account/pay/success/?session_id={CHECKOUT_SESSION_ID}`,
      // ?pay=cancelled lets the dashboard say what happened. Stripe's own
      // failure path buried people in back-history during testing (24 Aug);
      // landing home with a plain notice is the fix.
      cancel_url: `${origin}/account/dashboard/?pay=cancelled`,
      metadata,
      payment_intent_data: { metadata },
    });
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not start checkout. Please try again.' };
  }
}
