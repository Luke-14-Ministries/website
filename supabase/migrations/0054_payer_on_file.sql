-- 0054_payer_on_file.sql
--
-- Two findings from the same afternoon's testing, both about a payment record
-- that cannot answer a question asked later.
--
-- ===========================================================================
-- PART 1 -- THE REFUND WEBHOOK WAS BEING REFUSED AT THE TABLE
-- ===========================================================================
--
-- A $10 refund issued in the Stripe dashboard never appeared on the site.
-- Stripe delivered the event; the function returned 200; nothing was written.
-- The function log said why:
--
--   [stripe-refund-webhook] could not record refund pyr_1U8Zh1... for payment
--   b423deeb-...: permission denied for table payment_refunds
--
-- service_role bypasses RLS. It does NOT bypass table GRANTs, and
-- payment_refunds had none: only `payments` and `gifts` were ever granted
-- (0006, when the payment webhook was built). Every other table in the schema
-- is closed to service_role, which is the right default and should stay --
-- so this grants exactly the one table the refund webhook touches, and
-- exactly the three verbs it uses. No DELETE: a refund record is history.
--
-- The failure mode is worth naming, because it will recur in some other shape.
-- The webhook logs the error and returns 200 deliberately -- a non-200 makes
-- Stripe retry the same doomed call for days -- so a permission problem here
-- is SILENT from the outside. Stripe says delivered, the site shows nothing,
-- and the two disagree with no error anywhere a person would look. The lesson
-- for the next edge function is to check GRANTs first, not signatures.
--
-- Both trigger guards on payment_refunds (0044) are SECURITY DEFINER and do
-- no role checking -- they are arithmetic -- so grants alone are sufficient.

grant select, insert, update on table public.payment_refunds to service_role;

-- ===========================================================================
-- PART 2 -- WHO PAID, RECORDED AT THE TIME THEY PAID
-- ===========================================================================
--
-- A family paid $50, then changed their contact email. Stripe still shows the
-- address they used at checkout; the portal shows the new one; nothing joins
-- them. The payment is real, the money is real, and "was this us?" has become
-- unanswerable without a person remembering.
--
-- payments had no payer identity at all -- not a name, not an email. It leaned
-- on registration -> household -> current contact details, which is a LIVE
-- lookup: it tells you who the family is today, never who handed over the
-- money in March. For anything a family can edit, a payment record has to hold
-- its own copy.
--
-- So: a snapshot, written once when the payment is recorded and never updated
-- afterwards. It is deliberately NOT a foreign key and deliberately not kept
-- in step with the household -- drifting apart from the household record is
-- the entire point. If the two differ, both facts are true: this is who paid,
-- that is who the family is now.
--
-- Grandparents, churches and friends pay for camp too, so this was never
-- reliably the household's email even before anybody edited anything.

alter table public.payments
  add column if not exists payer_email text,
  add column if not exists payer_name text;

comment on column public.payments.payer_email is
  'The email on the payment AS AT the moment it was recorded -- from Stripe checkout for card/bank, or the household contact for a hand-recorded check. A frozen snapshot: never updated when the family edits their details, because matching a Stripe record later is exactly what it is for (0054).';

comment on column public.payments.payer_name is
  'The name on the payment as at the moment it was recorded. Snapshot, like payer_email -- and often not the household name, since grandparents and churches pay for camp.';

-- Left NULL on rows that predate this. The honest answer for an old payment is
-- "not recorded", and writing today's household email into a column that means
-- "the address used at the time" would manufacture exactly the false certainty
-- this migration exists to prevent. The Stripe reference is already on those
-- rows and remains the way to look them up.
