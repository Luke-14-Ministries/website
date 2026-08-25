# stripe-refund-webhook — what Lawrence has to configure

Deployed to Supabase on 24 Aug 2026 (`supabase/functions/stripe-refund-webhook/index.ts`).
It is live but **inert until Stripe is told to call it**.

## Why it is a second webhook rather than an edit to the first

The existing `stripe-webhook` records payments and money depends on it working.
Refunds are a separate concern with a separate failure mode, so they got their own
endpoint instead of surgery on a load-bearing path. The cost is one extra endpoint and
one extra secret; the benefit is that nothing about payments changed.

## What it is actually for

The staff refund screen already records every refund it issues, so most of the time this
function only confirms what is already true. It exists for the two cases the screen
cannot cover:

1. **A refund issued directly in the Stripe dashboard.** Without this, the money leaves
   the ministry's bank and the site never learns. The family's balance stays wrong until
   somebody reconciles by hand.
2. **A bank refund that fails later.** ACH refunds are asynchronous — "pending" today can
   become "failed" next week. Balances count pending refunds, so a silent failure leaves
   a balance permanently wrong in the family's favour.

## Setup — three steps

1. **Stripe → Developers → Webhooks → Add endpoint.**
   URL: `https://nnbcxqxwkivadzognpno.supabase.co/functions/v1/stripe-refund-webhook`
2. **Select events:** `charge.refunded`, `refund.created`, `refund.updated`,
   `refund.failed`. (Nothing else — the function ignores anything it does not handle,
   but a tighter subscription makes the Stripe dashboard readable.)
3. **Copy the signing secret** (`whsec_…`) into Supabase → Edge Functions → Secrets as
   **`STRIPE_REFUND_WEBHOOK_SECRET`**.

Do the same again with the live keys when the site goes live — test and live mode have
separate endpoints and separate secrets.

## Notes

- `verify_jwt` is **false**, and must stay false. Stripe does not send a Supabase JWT; it
  signs the request body. Authentication is the signature check inside the function. The
  payment webhook is configured the same way.
- It is **idempotent**: `payment_refunds.stripe_refund_id` is unique, so Stripe's retries
  and our own staff-issued refunds converge on one row.
- It will **not overwrite a registrar's `reason` or `note`** on a refund we already
  recorded. Stripe is authoritative about status and amount; a person's sentence about
  why is worth more than Stripe's enum.
- If migration 0044's over-refund guard refuses a row from this function, that means
  Stripe and our records genuinely disagree. It logs loudly and moves on rather than
  retrying forever — that case wants a human.
