-- 0008: gifts (online + mailed donations), separate from camp payments.
--
-- The 2024 Form 990 says why this table exists: contributions are ~84% of the
-- ministry's revenue -- most people who interact with Luke 14 financially are
-- donors, not camp families. A gift has no registration behind it and may have
-- no login (guest donors give without an account), so it cannot live in
-- payments (which requires a registration_id). Donations ARE tax-deductible;
-- camp payments are not -- keeping them in separate tables keeps receipts,
-- reporting, and year-end statements honest by construction.

create table if not exists public.gifts (
  id                       uuid primary key default gen_random_uuid(),
  -- Null for guest donors. Linked when the donor was logged in when giving.
  profile_id               uuid references public.profiles (id) on delete set null,
  donor_name               text,
  email                    text,
  amount_cents             integer not null check (amount_cents > 0),
  fund                     text not null default 'General Operating Fund',
  method                   text not null
                             check (method in ('card', 'bank_transfer', 'check', 'cash', 'other')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  received_on              date,
  stripe_payment_intent_id text,
  recorded_by              uuid references public.profiles (id) on delete set null,
  note                     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Webhook idempotency, same pattern as payments (0005).
create unique index if not exists gifts_stripe_payment_intent_uidx
  on public.gifts (stripe_payment_intent_id);
create index if not exists gifts_profile_idx on public.gifts (profile_id, created_at);

create trigger gifts_updated_at
  before update on public.gifts
  for each row execute function public.set_updated_at();

alter table public.gifts enable row level security;

-- A donor sees their own gifts; staff see all of them.
create policy gifts_select on public.gifts
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());

-- Online gifts are written by the Stripe webhook (service role). Staff may
-- record mailed checks and cash by hand.
create policy gifts_manual_insert on public.gifts
  for insert to authenticated
  with check (public.is_registrar() and method in ('check', 'cash', 'other'));

create policy gifts_manual_update on public.gifts
  for update to authenticated
  using (public.is_registrar() and method in ('check', 'cash', 'other'))
  with check (public.is_registrar() and method in ('check', 'cash', 'other'));

grant select, insert, update on public.gifts to authenticated;
-- The 0006 lesson, applied up front: the webhook writes as service_role, and
-- 0001's least-privilege defaults do not grant it DML.
grant select, insert, update on public.gifts to service_role;
