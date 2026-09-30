'use server';

// Starting a payment plan, and changing the card or bank account behind one.
//
// Neither writes the plan itself. Families can only READ payment_plans (0080),
// and that is deliberate: a plan earns a discount and authorizes charges, so
// it comes into existence only when Stripe confirms the deposit and the saved
// payment method -- in the stripe-webhook Edge Function, with the service key.
// This action only opens Stripe Checkout with everything the webhook will
// need riding along as metadata.

import { headers } from 'next/headers';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/server';
import { registrationDepositCents } from '@/lib/payments';
import { balanceDueOn, formatDueDate } from '@/lib/events';
import {
  planAvailable,
  planConsentText,
  PLAN_CONSENT_VERSION,
  SCHEDULE_LABEL,
} from '@/lib/plans';

async function originFromRequest() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

// The registration, only if it belongs to the caller's own household.
async function ownRegistration(supabase, userId, registrationId) {
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', userId);
  const ids = (memberships ?? []).map((m) => m.household_id);
  if (!ids.length || !registrationId) return null;
  const { data } = await supabase
    .from('registrations')
    .select(
      `id, events ( id, name, event_type, starts_on, deposit_cents ),
       registration_participants ( id, person_id, status )`
    )
    .eq('id', registrationId)
    .in('household_id', ids)
    .maybeSingle();
  return data;
}

export async function startPaymentPlan({ registrationId, schedule, method, agreed }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: 'Online payment is not switched on yet.' };
  if (!SCHEDULE_LABEL[schedule]) return { ok: false, error: 'Please choose how often to pay.' };
  if (method !== 'card' && method !== 'bank') return { ok: false, error: 'Please choose a payment method.' };
  if (!agreed) return { ok: false, error: 'Please tick the box to agree to the automatic payments.' };

  const supabase = await createClient();
  const reg = await ownRegistration(supabase, user.id, registrationId);
  if (!reg) return { ok: false, error: 'We could not find that registration.' };
  const ev = reg.events ?? {};
  if (!planAvailable(ev)) {
    return { ok: false, error: 'A payment plan is not available for this registration.' };
  }

  const [{ data: bal }, { data: existing }, { data: full }] = await Promise.all([
    supabase.from('registration_balances').select('balance_cents').eq('registration_id', reg.id).maybeSingle(),
    supabase.from('payment_plans').select('id, status').eq('registration_id', reg.id).maybeSingle(),
    supabase.rpc('pay_in_full_amount', { p_registration_id: reg.id }),
  ]);
  const balance = bal?.balance_cents ?? 0;
  if (balance <= 0) return { ok: false, error: 'This registration is already paid in full.' };
  if (existing && ['active', 'paused', 'failed', 'completed'].includes(existing.status)) {
    return { ok: false, error: 'This registration already has a payment plan.' };
  }

  // The deposit is the plan's first payment (Larry, 30 Sep): per person, as
  // everywhere else, and never more than the discounted total.
  const deposit = Math.min(
    registrationDepositCents({
      perPersonCents: ev.deposit_cents,
      participants: reg.registration_participants,
      balanceCents: balance,
    }),
    full ?? balance
  );
  if (!(deposit > 0)) return { ok: false, error: 'No deposit amount is set for this camp yet.' };

  const due = balanceDueOn(ev);
  const consent = planConsentText({ schedule, dueLabel: formatDueDate(due) });
  const origin = await originFromRequest();

  const metadata = {
    registration_id: reg.id,
    base_cents: String(deposit),
    fee_cents: '0',
    method,
    kind: 'plan_deposit',
    cover_fee: '0',
    event_name: ev.name ?? 'Camp registration',
    plan_schedule: schedule,
    consent_version: PLAN_CONSENT_VERSION,
    consent_text: consent,
    consented_by: user.id,
    consented_at: new Date().toISOString(),
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: method === 'bank' ? ['us_bank_account'] : ['card'],
      // A Stripe customer to keep the saved payment method on.
      customer_creation: 'always',
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: deposit,
            product_data: { name: `${ev.name ?? 'Camp registration'} — Deposit (payment plan)` },
          },
        },
      ],
      // Keep the payment method for the automatic charges that follow. Stripe
      // shows the family its own wording about future charges here too, and
      // for a bank account this is where the ACH debit mandate is collected.
      payment_intent_data: { setup_future_usage: 'off_session', metadata },
      metadata,
      success_url: `${origin}/account/pay/success/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account/finish/${reg.id}/?pay=cancelled`,
    });
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not start checkout. Please try again.' };
  }
}

// Replace the card or bank account a plan charges -- after a failed payment,
// or just because. Stripe Checkout in "setup" mode saves a new method without
// charging anything; the webhook swaps it onto the plan and, if the plan had
// stopped on a failure, sets it going again.
export async function updatePlanPaymentMethod({ registrationId, method }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: 'Online payment is not switched on yet.' };
  if (method !== 'card' && method !== 'bank') return { ok: false, error: 'Please choose a payment method.' };

  const supabase = await createClient();
  const reg = await ownRegistration(supabase, user.id, registrationId);
  if (!reg) return { ok: false, error: 'We could not find that registration.' };
  const { data: plan } = await supabase
    .from('payment_plans')
    .select('id, status, stripe_customer_id')
    .eq('registration_id', reg.id)
    .maybeSingle();
  if (!plan?.stripe_customer_id || !['active', 'paused', 'failed'].includes(plan.status)) {
    return { ok: false, error: 'There is no payment plan to update on this registration.' };
  }

  const origin = await originFromRequest();
  const metadata = { kind: 'plan_method_update', registration_id: reg.id, plan_id: plan.id };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      currency: 'usd',
      payment_method_types: method === 'bank' ? ['us_bank_account'] : ['card'],
      customer: plan.stripe_customer_id,
      metadata,
      setup_intent_data: { metadata },
      success_url: `${origin}/account/dashboard/?plan=updated`,
      cancel_url: `${origin}/account/dashboard/`,
    });
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not open the secure page. Please try again.' };
  }
}
