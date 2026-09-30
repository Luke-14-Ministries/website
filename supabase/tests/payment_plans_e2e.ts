// Scratch-database test of the payment-plan code paths, with a stand-in for
// Stripe. Not deployed; lives only in the test rig.
import { PostgrestClient } from 'npm:@supabase/postgrest-js@1';
import { activatePlanFromDeposit, applyNewPaymentMethod, recordInstallmentOutcome } from '../functions/_shared/plans.ts';
import { chargeDuePlans } from '../functions/_shared/charger.ts';

const token = (await Deno.readTextFile('/var/tmp/srv.jwt')).trim();
const admin = new PostgrestClient('http://localhost:3399', {
  headers: { Authorization: `Bearer ${token}`, apikey: token },
}) as any;
const REG = '50000000-0000-0000-0000-000000000001';
let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`);
}
async function bal() {
  const { data } = await admin.from('registration_balances').select('balance_cents, early_discount_cents, paid_cents').eq('registration_id', REG).single();
  return data;
}
async function insts() {
  const { data } = await admin.from('payment_installments').select('id, due_on, amount_cents, status, attempts, next_attempt_on, stripe_payment_intent_id').order('due_on');
  return data;
}
async function plan() {
  const { data } = await admin.from('payment_plans').select('*').eq('registration_id', REG).single();
  return data;
}

// ---- fake Stripe ------------------------------------------------------------
let nextOutcome: 'succeeded' | 'processing' | 'decline' = 'succeeded';
let piCount = 0;
const created: any[] = [];
const fakeStripe: any = {
  paymentIntents: {
    retrieve: async (id: string) => ({ id, payment_method: { id: 'pm_card', type: 'card', card: { brand: 'visa', last4: '4242' } } }),
    create: async (params: any, opts: any) => {
      created.push({ params, opts });
      const id = `pi_inst_${++piCount}`;
      if (nextOutcome === 'decline') {
        const err: any = new Error('Your card was declined.');
        err.payment_intent = { id, status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } };
        throw err;
      }
      return { id, status: nextOutcome, amount: params.amount };
    },
  },
  customers: { retrieve: async () => ({ id: 'cus_1', email: 'fam@example.org' }) },
  setupIntents: { retrieve: async () => ({ payment_method: { id: 'pm_new', type: 'us_bank_account', us_bank_account: { bank_name: 'Test Bank', last4: '6789' } } }) },
};

// ---- setup: early date, $50/person -------------------------------------------
// (event settings are staff-set; write them with the service role here)
async function sql(q: string) {
  const r = await new Deno.Command('psql', { args: ['-h', '/tmp', '-p', '55432', '-U', 'postgres', '-d', 't2', '-v', 'ON_ERROR_STOP=1', '-qc', q] }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
}
await sql(`update public.events set early_registration_ends_on='2026-12-31', early_registration_discount_cents=5000 where id='30000000-0000-0000-0000-000000000001'`);

// ---- A. deposit: stripe-webhook records it, stripe-plans-webhook activates ----
await admin.from('payments').insert({ registration_id: REG, amount_cents: 10000, method: 'card', status: 'succeeded', stripe_payment_intent_id: 'pi_dep' });
await admin.rpc('recalc_early_registration_discount', { p_registration_id: REG });
expect('A0 no discount before a plan (deposit alone)', (await bal()).early_discount_cents, 0);
const session: any = {
  payment_intent: 'pi_dep', customer: 'cus_1', payment_status: 'paid',
  metadata: { kind: 'plan_deposit', registration_id: REG, plan_schedule: 'monthly', consent_text: 'I authorize…', consented_by: '00000000-0000-0000-0000-00000000000a', consented_at: '2026-11-01T20:00:00Z', consent_version: 'plan-consent-v1', event_name: 'Camp Celebrate 2027 — Week 1' },
};
await activatePlanFromDeposit(admin, fakeStripe, session, 'succeeded');
await admin.rpc('recalc_early_registration_discount', { p_registration_id: REG });
let p = await plan();
expect('A1 plan active', p.status, 'active');
expect('A2 method label', p.payment_method_label, 'Visa ending 4242');
expect('A3 early discount now earned (2 people x $50)', (await bal()).early_discount_cents, 10000);
expect('A4 balance after deposit + discount', (await bal()).balance_cents, 100000);
let list = await insts();
expect('A5 installments built (real today → due 2027-07-04)', list.length > 0, true);
expect('A6 last installment on due date', list[list.length - 1].due_on, '2027-07-04');
// Re-delivery of the same checkout event must not rebuild or duplicate.
await activatePlanFromDeposit(admin, fakeStripe, session, 'succeeded');
expect('A7 re-delivery changes nothing', (await insts()).length, list.length);

// Make the schedule deterministic for the charger: 4 dates.
await admin.from('payment_installments').delete().eq('status', 'scheduled');
for (const d of ['2027-01-04', '2027-03-04', '2027-05-04', '2027-07-04']) {
  await admin.from('payment_installments').insert({ payment_plan_id: p.id, due_on: d, amount_cents: 0, status: 'scheduled' });
}

// ---- B. dry run then a successful card charge -----------------------------------
let out = await chargeDuePlans(admin, fakeStripe, { dry: true, today: '2027-01-04' });
expect('B0 dry run would charge 1/4 of 100000', (out.results[0] as any).would_charge_cents, 25000);
expect('B0b dry run charged nothing', created.length, 0);
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-01-04' });
expect('B1 charged 25000', (out.results[0] as any).charged_cents, 25000);
expect('B2 idempotency key per try', created[0].opts.idempotencyKey.endsWith('-1'), true);
expect('B3 off-session with saved method', [created[0].params.off_session, created[0].params.payment_method], [true, 'pm_card']);
expect('B4 balance', (await bal()).balance_cents, 75000);
list = await insts();
expect('B5 first installment paid', list[0].status, 'paid');
// Webhook sees the same PaymentIntent later: no double count.
await recordInstallmentOutcome(admin, { installmentId: list[0].id, registrationId: REG, piId: list[0].stripe_payment_intent_id, amountCents: 25000, method: 'card', outcome: 'succeeded' });
expect('B6 webhook re-delivery does not double count', (await bal()).balance_cents, 75000);
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-01-04' });
expect('B7 second run same day charges nothing', out.results.length, 0);

// ---- C. a decline, retries, and the plan stopping ------------------------------------
nextOutcome = 'decline';
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-03-04' });
expect('C1 decline recorded', (out.results[0] as any).outcome, 'failed');
list = await insts();
expect('C2 installment failed, try 1, retry set', [list[1].status, list[1].attempts, Boolean(list[1].next_attempt_on)], ['failed', 1, true]);
expect('C3 balance unchanged by failure', (await bal()).balance_cents, 75000);
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-03-05' });
expect('C4 not retried before its retry date', out.results.length, 0);
// Force the retry date to "today" twice more to exhaust tries.
for (const n of [2, 3]) {
  await admin.from('payment_installments').update({ next_attempt_on: '2027-03-10' }).eq('id', list[1].id);
  await chargeDuePlans(admin, fakeStripe, { today: '2027-03-10' });
}
list = await insts();
expect('C5 three tries used', list[1].attempts, 3);
expect('C6 plan stopped as failed', (await plan()).status, 'failed');
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-05-04' });
expect('C7 a failed plan is not charged', out.results.length, 0);
expect('C8 discount kept while staff decide', (await bal()).early_discount_cents, 10000);

// ---- D. family saves a new bank account -> plan restarts --------------------------
await applyNewPaymentMethod(admin, fakeStripe, { setup_intent: 'seti_1', metadata: { kind: 'plan_method_update', plan_id: p.id } } as any);
p = await plan();
expect('D1 plan active again with new method', [p.status, p.payment_method_label, p.payment_method_kind], ['active', 'Test Bank ending 6789', 'us_bank_account']);
list = await insts();
expect('D2 failed charge gets fresh tries', list[1].attempts, 0);

// ---- E. bank transfer: processing, then settles via webhook ------------------------
nextOutcome = 'processing';
await admin.from('payment_installments').update({ next_attempt_on: '2027-05-04' }).eq('id', list[1].id);
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-05-04' });
expect('E1 bank charge processing (3 charges left → 1/3)', [(out.results[0] as any).outcome, (out.results[0] as any).charged_cents], ['processing', 25000]);
expect('E2 processing counts toward balance', (await bal()).balance_cents, 50000);
list = await insts();
await recordInstallmentOutcome(admin, { installmentId: list[1].id, registrationId: REG, piId: list[1].stripe_payment_intent_id, amountCents: 25000, method: 'bank_transfer', outcome: 'succeeded' });
list = await insts();
expect('E3 settled', list[1].status, 'paid');

// ---- F. a scholarship mid-plan shrinks the rest; last charge lands on $0 -------------
await sql(`update public.registration_participants set scholarship_cents=20000 where id='60000000-0000-0000-0000-000000000001'`);
await admin.rpc('recalc_early_registration_discount', { p_registration_id: REG });
expect('F0 balance after scholarship', (await bal()).balance_cents, 30000);
nextOutcome = 'succeeded';
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-05-05' });
expect('F1 next is 1/2 of what is left', (out.results[0] as any).charged_cents, 15000);
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-07-04' });
expect('F2 last charge takes the rest', (out.results[0] as any).charged_cents, 15000);
expect('F3 balance exactly zero', (await bal()).balance_cents, 0);
expect('F4 plan completed', (await plan()).status, 'completed');
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-07-10' });
expect('F5 nothing more is ever charged', out.results.length, 0);

// ---- G. review fixes (30 Sep) ---------------------------------------------------
// G1: a bounced bank deposit undoes the plan: no discount, not finished.
await sql(`delete from public.payments; delete from public.payment_installments; delete from public.payment_plans;
  update public.registration_participants set scholarship_cents = 0;`);
await admin.from('payments').insert({ registration_id: REG, amount_cents: 10000, method: 'bank_transfer', status: 'processing', stripe_payment_intent_id: 'pi_dep2' });
const achSession: any = { ...session, payment_intent: 'pi_dep2', payment_status: 'unpaid' };
await activatePlanFromDeposit(admin, fakeStripe, achSession, 'processing');
await admin.rpc('recalc_early_registration_discount', { p_registration_id: REG });
expect('G1a ACH deposit processing -> plan active, discount on', [(await plan()).status, (await bal()).early_discount_cents], ['active', 10000]);
await admin.from('payments').update({ status: 'failed' }).eq('stripe_payment_intent_id', 'pi_dep2');
await activatePlanFromDeposit(admin, fakeStripe, achSession, 'failed');
p = await plan();
expect('G1b bounced deposit -> plan pending, not activated', [p.status, p.activated_at], ['pending', null]);
expect('G1c discount removed', (await bal()).early_discount_cents, 0);
const { data: rt } = await admin.from('registration_payment_routes').select('route').eq('registration_id', REG).single();
expect('G1d registration not finished again', rt.route, 'none');
expect('G1e schedule cancelled', (await insts()).every((i: any) => i.status === 'cancelled'), true);
// G1f: a bounce from some OTHER checkout (second tab) cannot undo a working plan.
await admin.from('payments').insert({ registration_id: REG, amount_cents: 10000, method: 'card', status: 'succeeded', stripe_payment_intent_id: 'pi_dep_tab1' });
await activatePlanFromDeposit(admin, fakeStripe, { ...session, payment_intent: 'pi_dep_tab1' }, 'succeeded');
await activatePlanFromDeposit(admin, fakeStripe, { ...achSession, payment_intent: 'pi_dep_tab2' }, 'failed');
expect('G1f other tab bounce leaves the plan active', (await plan()).status, 'active');
await sql(`delete from public.payments where stripe_payment_intent_id='pi_dep_tab1';
  update public.payment_plans set status='pending', activated_at=null, deposit_payment_intent_id=null;
  update public.payment_installments set status='cancelled';`);
// G2: the family tries again, successfully.
await admin.from('payments').insert({ registration_id: REG, amount_cents: 10000, method: 'card', status: 'succeeded', stripe_payment_intent_id: 'pi_dep3' });
await activatePlanFromDeposit(admin, fakeStripe, { ...session, payment_intent: 'pi_dep3' }, 'succeeded');
await admin.rpc('recalc_early_registration_discount', { p_registration_id: REG });
expect('G2 second attempt activates', [(await plan()).status, (await bal()).early_discount_cents], ['active', 10000]);
// G3: last bank charge still clearing -> plan waits, is not completed.
p = await plan();
await sql(`delete from public.payment_installments where status <> 'cancelled';
  insert into public.payment_installments (payment_plan_id, due_on, amount_cents, status) values ('${p.id}','2027-07-04',0,'scheduled');
  update public.payment_plans set payment_method_kind='us_bank_account' where id='${p.id}';`);
nextOutcome = 'processing';
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-07-04' });
expect('G3a last charge takes everything, clearing', [(out.results[0] as any).charged_cents, (out.results[0] as any).outcome], [100000, 'processing']);
expect('G3b plan NOT completed while clearing', (await plan()).status, 'active');
const beforeWait = created.length;
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-07-05' });
expect('G3c charger charges nothing while the last payment clears', created.length, beforeWait);
expect('G3d plan still open', (await plan()).status, 'active');
// G4: it bounces -> retried, still a plan; staff alerted (email off in tests).
list = await insts();
const last = list.find((i: any) => i.status === 'processing');
await recordInstallmentOutcome(admin, { installmentId: last.id, registrationId: REG, piId: last.stripe_payment_intent_id, amountCents: 100000, method: 'bank_transfer', outcome: 'failed', error: 'insufficient funds', today: '2027-07-06' });
list = await insts();
expect('G4 bounced last charge is failed with a retry date', [list.find((i: any) => i.id === last.id).status, list.find((i: any) => i.id === last.id).next_attempt_on], ['failed', '2027-07-09']);
expect('G4b balance owed again', (await bal()).balance_cents, 100000);
// G5: crash gap -- Stripe charged but the charger died before recording.
await sql(`update public.payment_installments set status='scheduled', stripe_payment_intent_id=null, attempts=2 where id='${last.id}'`);
// A late Stripe retry for an EARLIER try (attempt 1) must not claim it...
await recordInstallmentOutcome(admin, { installmentId: last.id, registrationId: REG, piId: 'pi_stale', amountCents: 100000, method: 'card', outcome: 'failed', error: 'old', today: '2027-07-09', attempt: 1 });
list = await insts();
expect('G5-0 stale retry of an earlier try does not claim', [list.find((i: any) => i.id === last.id).status, list.find((i: any) => i.id === last.id).stripe_payment_intent_id], ['scheduled', null]);
// ...but the current try's own webhook does.
await recordInstallmentOutcome(admin, { installmentId: last.id, registrationId: REG, piId: 'pi_orphan', amountCents: 100000, method: 'card', outcome: 'succeeded', today: '2027-07-09', attempt: 2 });
list = await insts();
expect('G5a webhook claims the unrecorded charge', [list.find((i: any) => i.id === last.id).status, list.find((i: any) => i.id === last.id).stripe_payment_intent_id], ['paid', 'pi_orphan']);
nextOutcome = 'succeeded';
const before = created.length;
out = await chargeDuePlans(admin, fakeStripe, { today: '2027-07-10' });
expect('G5b nothing charged twice', created.length, before);
expect('G5c plan completed on settled money', (await plan()).status, 'completed');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
Deno.exit(failures ? 1 : 0);
