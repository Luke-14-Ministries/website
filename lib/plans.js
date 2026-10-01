// Payment plans: the words and the small rules the pages share.
//
// The money rules live in the database (migration 0080) so that the website,
// the Stripe webhook and the daily charger can never disagree:
//   balance_due_on()                    -- the due date (mirrors balanceDueOn())
//   plan_charge_dates()                 -- the charge dates after the deposit
//   recalc_early_registration_discount()-- the early discount
//   registration_payment_routes (view)  -- "has this family finished registering?"
// This file is only what the pages need to SAY about them.

import { balanceDueOn, dateISO } from './events';

export const SCHEDULE_LABEL = {
  monthly: 'Monthly',
  semi_monthly: 'Twice a month',
};

export const PLAN_STATUS_LABEL = {
  pending: 'Setting up',
  active: 'Active',
  paused: 'Paused by staff',
  failed: 'Payment problem',
  cancelled: 'Cancelled',
  completed: 'Paid in full',
};

// A plan needs at least a week between now and the due date to be worth
// setting up; closer than that, the family pays in full or asks for help.
export const PLAN_MIN_DAYS = 7;

// Whether a registration counts as "not finished" until the family picks
// pay in full / payment plan / scholarship.
//
// OFF since 30 Sep 2026 (Lawrence, staff questions): a family submits with
// nothing paid; the $50 deposit is what staff need for APPROVAL (unless a
// full scholarship is requested), and staff sort registrations into three
// classes instead -- see registration_review (0081) and REVIEW_CLASS below.
// Paying in full and payment plans stay on offer through /account/finish/.
// Every "not finished" banner, pill and column keys off this one function, so
// turning it back on is one line. The `event` argument is kept for that.
export function requiresPaymentChoice(event) {
  return false;
}

// Only camp weeks carry a due date, so only camp weeks offer a plan.
export function offersPaymentPlan(event) {
  return balanceDueOn(event) != null;
}

// The three classes staff review registrations in (Lawrence, 30 Sep 2026),
// from registration_review.review_class (0081).
export const REVIEW_CLASS = {
  deposit_paid: { label: 'Deposit received', hint: 'Review and approve', cls: 'bg-green-100 text-green-800' },
  full_scholarship: { label: 'Full scholarship requested', hint: 'Reach out to the family', cls: 'bg-blue-100 text-blue-800' },
  neither: { label: 'No deposit yet', hint: 'No review needed yet', cls: 'bg-neutral-100 text-neutral-600' },
};

// registration_review.flags: reasons for a second look, whatever the class.
export const REVIEW_FLAG = {
  deposit_short: 'Deposit short of $50 a person',
  media_declined: 'Photo permission declined',
  creed_not_affirmed: "Apostles' Creed not affirmed",
};

// Server components only (reads the clock -- see THE CLOCK in lib/events.js).
export function planAvailable(event, now = Date.now()) {
  const due = balanceDueOn(event);
  return Boolean(due) && due > dateISO(PLAN_MIN_DAYS, now);
}

// The consent a family gives for recurring charges. Stored word for word on
// the plan (payment_plans.consent_text) with who agreed and when, so it can
// be shown back if a charge is ever questioned. Kept under Stripe's 500
// character metadata limit, because it travels to the webhook that way.
// Change the wording -> bump the version.
export const PLAN_CONSENT_VERSION = 'plan-consent-v1';

const CONSENT_CADENCE = {
  monthly: 'once a month',
  semi_monthly: 'twice a month (on the 1st and 15th)',
};

export function planConsentText({ schedule, dueLabel }) {
  return (
    `I authorize Luke 14 Ministries to charge the payment method I save today: the deposit now, ` +
    `then the remaining balance in equal payments ${CONSENT_CADENCE[schedule] ?? schedule}, with the ` +
    `last one on ${dueLabel}. Amounts can go down if my balance changes. I can ask the ministry to ` +
    `change or cancel this plan at any time.`
  );
}

// Registration-wide "what does this family still have to do?" wording, from
// registration_payment_routes.route.
export const ROUTE_LABEL = {
  plan: 'Payment plan',
  paid_in_full: 'Paid in full',
  nothing_owed: 'Nothing owed',
  scholarship: 'Scholarship requested',
  none: 'Not finished — no payment choice',
};
