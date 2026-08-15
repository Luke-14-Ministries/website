-- 0005: Stripe payments support.
--
-- (1) Idempotency guard: a unique index on the Stripe payment-intent id, so a
--     webhook retry upserts the same row instead of recording a payment twice.
--     A plain unique index (not partial) is used deliberately -- Postgres treats
--     NULLs as distinct, so cash/cheque rows (no intent id) are unaffected, and
--     ON CONFLICT (stripe_payment_intent_id) resolves cleanly.
create unique index if not exists payments_stripe_payment_intent_uidx
  on public.payments (stripe_payment_intent_id);

-- (2) Placeholder deposit: $50 per registration for both Camp Celebrate weeks,
--     so "pay a deposit" works end to end. This is data, not structure --
--     staff set the real amount later from the Setup screen.
update public.events
  set deposit_cents = 5000
  where name like 'Camp Celebrate 2026%' and deposit_cents = 0;
