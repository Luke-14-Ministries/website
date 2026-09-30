// The daily charger's work, apart from the HTTP wrapper in
// charge-payment-plans/index.ts, so it can be exercised against a scratch
// database with a stand-in for Stripe. See that file for the why.

import Stripe from 'npm:stripe';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ministryToday, recordInstallmentOutcome, settledBalance } from './plans.ts';

export async function chargeDuePlans(
  admin: SupabaseClient,
  stripe: Stripe,
  { dry = false, today: todayOverride }: { dry?: boolean; today?: string } = {}
) {
  const today = todayOverride ?? ministryToday();

  // Due today or earlier and still scheduled, or failed with a retry due --
  // on plans that are active. Paused, failed and cancelled plans are skipped.
  const { data: rows, error } = await admin
    .from('payment_installments')
    .select(
      `id, due_on, status, attempts, next_attempt_on, payment_plan_id, stripe_payment_intent_id,
       payment_plans!inner ( id, status, registration_id, stripe_customer_id,
         stripe_payment_method_id, payment_method_kind )`
    )
    .eq('payment_plans.status', 'active')
    .in('status', ['scheduled', 'failed'])
    .lte('due_on', today)
    .order('due_on', { ascending: true });
  if (error) throw new Error(error.message);

  const ready = (rows ?? []).filter(
    (r) => r.status === 'scheduled' || (r.next_attempt_on && r.next_attempt_on <= today)
  );

  // One charge per plan per run: the oldest due installment.
  const firstPerPlan = new Map<string, (typeof ready)[number]>();
  for (const r of ready) if (!firstPerPlan.has(r.payment_plan_id)) firstPerPlan.set(r.payment_plan_id, r);

  const results: unknown[] = [];
  for (const inst of firstPerPlan.values()) {
    const plan = inst.payment_plans as unknown as {
      id: string;
      registration_id: string;
      stripe_customer_id: string | null;
      stripe_payment_method_id: string | null;
      payment_method_kind: string | null;
    };
    try {
      const [{ data: bal }, { count: left }, { data: reg }] = await Promise.all([
        admin
          .from('registration_balances')
          .select('balance_cents')
          .eq('registration_id', plan.registration_id)
          .maybeSingle(),
        admin
          .from('payment_installments')
          .select('id', { count: 'exact', head: true })
          .eq('payment_plan_id', plan.id)
          .in('status', ['scheduled', 'failed']),
        admin
          .from('registrations')
          .select('events ( name ), households ( email )')
          .eq('id', plan.registration_id)
          .maybeSingle(),
      ]);
      const balance = Math.max(0, bal?.balance_cents ?? 0);
      const { settled, inFlight } = await settledBalance(admin, plan.registration_id);
      const eventName = (reg?.events as { name?: string } | null)?.name ?? 'Camp registration';

      // Nothing owed, but a bank payment is still clearing: wait for it
      // rather than closing the plan on money that might bounce.
      if (balance === 0 && settled > 0) {
        results.push({ plan: plan.id, action: `waiting — ${inFlight} cents still clearing` });
        continue;
      }
      // Nothing owed any more (a scholarship, an extra payment): close up.
      if (balance === 0) {
        if (!dry) {
          await admin
            .from('payment_installments')
            .update({ status: 'waived' })
            .eq('payment_plan_id', plan.id)
            .in('status', ['scheduled', 'failed']);
          await admin.from('payment_plans').update({ status: 'completed' }).eq('id', plan.id);
        }
        results.push({ plan: plan.id, action: 'completed — nothing owed' });
        continue;
      }

      // Equal shares of what is owed now; the last charge takes the rest.
      // Stripe will not charge under $0.50, so a tiny share folds into this one.
      const charges = Math.max(1, left ?? 1);
      let amount = charges === 1 ? balance : Math.ceil(balance / charges);
      if (amount < 100 || balance - amount < 100) amount = balance;

      if (dry) {
        results.push({ plan: plan.id, installment: inst.id, would_charge_cents: amount, charges_left: charges });
        continue;
      }
      if (!plan.stripe_customer_id || !plan.stripe_payment_method_id) {
        results.push({ plan: plan.id, error: 'no saved payment method' });
        continue;
      }

      const attempt = (inst.attempts ?? 0) + 1;
      const method = plan.payment_method_kind === 'us_bank_account' ? 'bank_transfer' : 'card';
      const metadata = {
        kind: 'plan_installment',
        registration_id: plan.registration_id,
        installment_id: inst.id,
        base_cents: String(amount),
        method: method === 'bank_transfer' ? 'bank' : 'card',
        event_name: eventName,
        attempt: String(attempt),
      };

      // Claim the try BEFORE charging: count it, and clear the installment's
      // PaymentIntent so whichever of charger and webhook records the outcome
      // can tie it (see recordInstallmentOutcome). If the function dies after
      // Stripe charges, the webhook still records it and the installment is
      // not charged again tomorrow.
      const { error: claimErr } = await admin
        .from('payment_installments')
        .update({
          stripe_payment_intent_id: null,
          status: 'scheduled',
          attempts: attempt,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', inst.id);
      if (claimErr) throw new Error(`claim: ${claimErr.message}`);

      // The idempotency key is per try, so a run that is re-run within
      // Stripe's window cannot charge the same try twice.
      let pi: Stripe.PaymentIntent | null = null;
      let failure: string | null = null;
      try {
        pi = await stripe.paymentIntents.create(
          {
            amount,
            currency: 'usd',
            customer: plan.stripe_customer_id,
            payment_method: plan.stripe_payment_method_id,
            payment_method_types: [plan.payment_method_kind === 'us_bank_account' ? 'us_bank_account' : 'card'],
            off_session: true,
            confirm: true,
            description: `${eventName} — scheduled payment`,
            metadata,
          },
          { idempotencyKey: `plan-inst-${inst.id}-${attempt}` }
        );
      } catch (e) {
        const se = e as Stripe.errors.StripeError & { payment_intent?: Stripe.PaymentIntent };
        failure = se.message ?? 'Payment failed';
        pi = se.payment_intent ?? null;
        if (!pi) {
          // Stripe never created a charge (network, configuration): not the
          // family's failure. Put the installment back exactly as it was --
          // the try is not used up and a retry date is not skipped -- and
          // tomorrow's run tries again.
          await admin
            .from('payment_installments')
            .update({
              status: inst.status,
              attempts: inst.attempts ?? 0,
              stripe_payment_intent_id: inst.stripe_payment_intent_id ?? null,
              last_error: failure,
              last_attempt_at: new Date().toISOString(),
            })
            .eq('id', inst.id);
          results.push({ plan: plan.id, installment: inst.id, error: failure, retried: 'tomorrow' });
          continue;
        }
      }

      // Recording ties the installment to this PaymentIntent. Each try starts
      // from 'scheduled' (set above), so a retry of an already-failed
      // installment moves scheduled -> failed again and is handled -- found in
      // testing 30 Sep: without that reset the second and third failures
      // matched nothing, the plan never stopped, and the charge re-ran daily.

      const outcome =
        pi.status === 'succeeded' ? 'succeeded' : pi.status === 'processing' ? 'processing' : 'failed';
      const customer = await stripe.customers.retrieve(plan.stripe_customer_id);
      const payerEmail =
        (customer && !('deleted' in customer && customer.deleted) ? (customer as Stripe.Customer).email : null) ??
        (reg?.households as { email?: string } | null)?.email ??
        null;

      await recordInstallmentOutcome(admin, {
        installmentId: inst.id,
        registrationId: plan.registration_id,
        piId: pi.id,
        amountCents: amount,
        method,
        outcome,
        error: outcome === 'failed' ? failure ?? pi.last_payment_error?.message ?? 'Payment failed' : null,
        payerEmail,
        eventName,
        today,
        attempt,
      });
      results.push({ plan: plan.id, installment: inst.id, charged_cents: amount, outcome });
    } catch (e) {
      console.error(`[charge-payment-plans] plan ${plan.id}: ${String((e as Error)?.message ?? e)}`);
      results.push({ plan: plan.id, error: String((e as Error)?.message ?? e) });
    }
  }

  return { today, dry, results };
}
