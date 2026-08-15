-- 0007: record the fee-cover portion of a payment as data, not prose.
--
-- When a payer ticks "cover the processing fee," the extra never counts toward
-- the registration balance -- amount_cents stays the balance-facing figure --
-- but the ministry needs to report on it (and the treasurer/board may decide
-- how to classify it). A column makes it summable; the note remains for humans.

alter table public.payments
  add column if not exists fee_cover_cents integer not null default 0
  check (fee_cover_cents >= 0);

comment on column public.payments.fee_cover_cents is
  'Extra the payer voluntarily added to cover processing fees. Never counts toward the registration balance (amount_cents is the balance-facing figure). Kept as its own column so giving/fee reports can sum it; whether it is classified as a donation is a treasurer/board decision.';
