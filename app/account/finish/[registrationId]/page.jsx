import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { balanceDueOn, formatDueDate, dateISO } from '@/lib/events';
import { registrationDepositCents } from '@/lib/payments';
import { planAvailable, planConsentText } from '@/lib/plans';
import FinishChoices from './FinishChoices';

export const metadata = { title: 'Finish Registering — Luke 14 Ministries' };

// The last step of registering for a camp week (Larry, 30 Sep 2026): the
// family chooses how the balance will be paid, and the registration is not
// finished until they do.
//
//   * Pay in full now      -- earns the early-registration discount if early
//   * Payment plan         -- deposit now, the rest charged automatically;
//                             also earns the early discount
//   * Request a scholarship -- the existing scholarship page
//
// Whether a family has finished is not stored as a flag: it is worked out by
// the registration_payment_routes view from what actually happened (a plan
// that got past its deposit, a paid balance, a scholarship request). A flag
// could say "plan" while no plan exists.
export default async function FinishPage({ params }) {
  const { registrationId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/account/?next=/account/finish/${registrationId}/`);

  const supabase = await createClient();

  // Scoped to the caller's own household EXPLICITLY -- staff RLS is broad,
  // and a staff member's own "finish registering" page must never open
  // somebody else's family (CLAUDE.md working rules).
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (householdIds.length === 0) notFound();

  const { data: reg } = await supabase
    .from('registrations')
    .select(
      `id, household_id, created_at,
       events ( id, name, event_type, starts_on, ends_on, deposit_cents,
                early_registration_ends_on, early_registration_discount_cents ),
       registration_participants ( id, person_id, status, fee_cents, camp_role )`
    )
    .eq('id', registrationId)
    .in('household_id', householdIds)
    .maybeSingle();
  if (!reg) notFound();

  const [{ data: bal }, { data: route }, { data: payInFull }] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('balance_cents, paid_cents, fee_cents, early_discount_cents')
      .eq('registration_id', registrationId)
      .maybeSingle(),
    supabase
      .from('registration_payment_routes')
      .select('route, plan_status')
      .eq('registration_id', registrationId)
      .maybeSingle(),
    supabase.rpc('pay_in_full_amount', { p_registration_id: registrationId }),
  ]);

  const ev = reg.events ?? {};
  const balance = bal?.balance_cents ?? 0;
  const full = Math.min(balance, payInFull ?? balance);
  const earlySaving = Math.max(0, balance - full);
  const due = balanceDueOn(ev);
  const today = dateISO(0);
  const canPlan = planAvailable(ev) && balance > 0;
  const deposit = registrationDepositCents({
    perPersonCents: ev.deposit_cents,
    participants: reg.registration_participants,
    balanceCents: balance,
  });

  // The plan's charge dates for both schedules, from the database's own rule,
  // so the preview is exactly what the charger will do.
  let preview = null;
  if (canPlan) {
    const [{ data: monthly }, { data: semi }] = await Promise.all([
      supabase.rpc('plan_charge_dates', { p_today: today, p_due: due, p_schedule: 'monthly' }),
      supabase.rpc('plan_charge_dates', { p_today: today, p_due: due, p_schedule: 'semi_monthly' }),
    ]);
    const afterDeposit = Math.max(0, full - deposit);
    const build = (dates) => {
      const list = [...(dates ?? [])].map((d) => (typeof d === 'string' ? d : d?.plan_charge_dates)).sort();
      return {
        dates: list,
        each: list.length ? Math.ceil(afterDeposit / list.length) : afterDeposit,
      };
    };
    const dueLabel = formatDueDate(due);
    preview = {
      monthly: { ...build(monthly), consent: planConsentText({ schedule: 'monthly', dueLabel }) },
      semi_monthly: {
        ...build(semi),
        consent: planConsentText({ schedule: 'semi_monthly', dueLabel }),
      },
    };
  }

  const done = route?.route && route.route !== 'none';

  return (
    <section className="section">
      <div className="max-w-2xl mx-auto">
        <Link href="/account/dashboard/" className="text-sm text-brand underline">
          ← Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold mt-3 mb-1">Finish registering</h1>
        <p className="text-neutral-600 mb-6">
          {ev.name}. One last step: choose how you&rsquo;ll pay.
          {due && (
            <>
              {' '}The balance is due by <strong>{formatDueDate(due)}</strong>, two weeks before
              camp starts.
            </>
          )}
        </p>

        {done ? (
          <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-green-900">
            <p className="font-semibold">You&rsquo;re all set — this registration is finished.</p>
            <p className="mt-1 text-sm">
              {route.route === 'plan' && 'Your payment plan is in place. Its schedule is on your dashboard.'}
              {route.route === 'paid_in_full' && 'Your balance is paid in full. Thank you!'}
              {route.route === 'nothing_owed' && 'There is nothing to pay on this registration.'}
              {route.route === 'scholarship' &&
                'Your scholarship request is with camp staff. They will be in touch.'}
            </p>
            <Link href="/account/dashboard/" className="btn-primary mt-3 inline-block !py-2">
              Go to my dashboard
            </Link>
          </div>
        ) : (
          <FinishChoices
            registrationId={reg.id}
            balanceCents={balance}
            payInFullCents={full}
            earlySavingCents={earlySaving}
            earlyEndsOn={ev.early_registration_ends_on ?? null}
            depositCents={deposit}
            canPlan={canPlan}
            preview={preview}
            planPending={route?.plan_status === 'pending'}
          />
        )}
      </div>
    </section>
  );
}
