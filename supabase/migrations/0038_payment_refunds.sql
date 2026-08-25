-- 0038 — refunds, including partial ones.
--
-- The board's position (relayed 24 Aug): the ministry must be able to give
-- money BACK, not only issue a credit against a future balance. Until now the
-- site could take a payment and reduce a balance, and nothing more, which made
-- "we'll put it toward next year" the only available answer to a family whose
-- circumstances changed.
--
-- WHY A TABLE AND NOT A NEGATIVE PAYMENT ROW
-- A refund as payments(amount_cents = -5000) makes the balance arithmetic fall
-- out for free, and is wrong for three reasons: payments.amount_cents is
-- CHECKed > 0 (0001 already decided this); "money arrived" and "money left"
-- would become indistinguishable in every list, export and receipt; and a
-- refund has facts of its own -- which payment it reverses, who authorised it,
-- Stripe's own refund id -- that have nowhere to live on a payment row.
--
-- PARTIAL REFUNDS are the normal case, not the exception: a family who cancels
-- one of three children, or forfeits a deposit but gets the balance back. So
-- MANY refunds may reference ONE payment, and the trigger below is what stops
-- their total exceeding it.
--
-- FEE COVER is tracked separately and deliberately. When a family added ~3% to
-- cover card processing, that money never counted toward their balance, and
-- Stripe does not return its cut when a payment is refunded -- so refunding it
-- costs the ministry real money. Staff can still choose to (fee_cover_cents),
-- because "you can't have your $2 back" is a bad conversation, but it stays a
-- separate, deliberate number rather than something that happens silently.

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),

  payment_id uuid not null references public.payments(id) on delete restrict,
  -- Denormalised from the payment on purpose: every balance query filters by
  -- registration, and carrying it here keeps that a single-table scan. The
  -- trigger below guarantees the two never disagree.
  registration_id uuid not null references public.registrations(id) on delete restrict,

  -- What goes back to the family and counts against what they have paid.
  amount_cents int not null check (amount_cents > 0),
  -- Any processing-fee contribution also being returned. Never affects the
  -- balance -- it was never part of it.
  fee_cover_cents int not null default 0 check (fee_cover_cents >= 0),

  -- 'pending'   sent to Stripe, not yet settled
  -- 'succeeded' the money is back with the family
  -- 'failed'    Stripe refused it (a closed card, usually)
  -- 'canceled'  withdrawn before it went anywhere
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'canceled')),

  -- Why. Not optional in practice -- a refund without a reason is unauditable
  -- a year later -- but not NOT NULL, because a Stripe-initiated dispute
  -- refund may arrive through the webhook before anyone types anything.
  reason text,
  note text,

  stripe_refund_id text unique,
  method text not null default 'stripe'
    check (method in ('stripe', 'check', 'cash', 'other')),

  refunded_by uuid references public.profiles(id) on delete set null,
  refunded_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payment_refunds is
  'Money returned to a family. Many refunds may reference one payment (partial refunds are normal); the total is capped at the payment amount by trigger. amount_cents reduces what the family has paid; fee_cover_cents does not, because a fee contribution never counted toward the balance.';

create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);
create index if not exists payment_refunds_registration_idx on public.payment_refunds (registration_id);
create index if not exists payment_refunds_status_idx on public.payment_refunds (status);

-- ---------------------------------------------------------------------------
-- The guard. A CHECK constraint cannot see sibling rows, so the "never refund
-- more than was paid" rule has to be a trigger. It also pins registration_id
-- to the payment's own, so the denormalised column cannot drift or be used to
-- credit a different family's registration.
-- ---------------------------------------------------------------------------
create or replace function public.payment_refunds_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_payment record;
  v_already int;
begin
  select p.registration_id, p.amount_cents, p.fee_cover_cents, p.status
    into v_payment
  from public.payments p
  where p.id = new.payment_id;

  if v_payment is null then
    raise exception 'payment not found';
  end if;

  -- Refunding something that never settled is a contradiction; cancel it
  -- instead. ('processing' is allowed: an ACH debit already on its way can be
  -- refunded once it lands, and staff queue that deliberately.)
  if v_payment.status not in ('succeeded', 'processing', 'refunded') then
    raise exception 'cannot refund a payment with status %', v_payment.status;
  end if;

  new.registration_id := v_payment.registration_id;

  select coalesce(sum(r.amount_cents), 0) into v_already
  from public.payment_refunds r
  where r.payment_id = new.payment_id
    and r.status in ('pending', 'succeeded')
    and (tg_op = 'INSERT' or r.id <> new.id);

  if new.status in ('pending', 'succeeded')
     and v_already + new.amount_cents > v_payment.amount_cents then
    raise exception
      'refund total (%) would exceed the payment (%)',
      v_already + new.amount_cents, v_payment.amount_cents;
  end if;

  if new.fee_cover_cents > v_payment.fee_cover_cents then
    raise exception 'fee-cover refund exceeds the fee cover paid';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payment_refunds_guard_trg on public.payment_refunds;
create trigger payment_refunds_guard_trg
  before insert or update on public.payment_refunds
  for each row execute function public.payment_refunds_guard();

-- ---------------------------------------------------------------------------
-- Row-level security. Families READ their own refunds -- a refund they cannot
-- see is a refund they will telephone about -- and never write one. Only a
-- registrar may create or change one.
-- ---------------------------------------------------------------------------
alter table public.payment_refunds enable row level security;

drop policy if exists payment_refunds_select on public.payment_refunds;
create policy payment_refunds_select on public.payment_refunds
  for select using (
    public.is_staff()
    or registration_id in (
      select r.id from public.registrations r
      where r.household_id in (select public.my_household_ids())
    )
  );

drop policy if exists payment_refunds_insert on public.payment_refunds;
create policy payment_refunds_insert on public.payment_refunds
  for insert with check (public.is_registrar());

drop policy if exists payment_refunds_update on public.payment_refunds;
create policy payment_refunds_update on public.payment_refunds
  for update using (public.is_registrar()) with check (public.is_registrar());

-- No delete policy, deliberately: a refund that happened is a fact. A refund
-- entered in error is marked 'canceled', which keeps the trail.

grant select on public.payment_refunds to authenticated;
grant insert, update on public.payment_refunds to authenticated;

-- ---------------------------------------------------------------------------
-- The balance view learns about refunds.
--
-- paid_cents now means "what the family is currently out of pocket toward this
-- registration" -- payments in, refunds back out. A pending refund counts
-- immediately, matching how a processing payment counts immediately: in both
-- cases the money is committed and moving, and showing a balance that ignores
-- it invites a second refund on top of the first.
-- ---------------------------------------------------------------------------
create or replace view public.registration_balances
with (security_invoker = true) as
 SELECT r.id AS registration_id,
    r.household_id,
    r.event_id,
    COALESCE(f.fee_cents, 0::bigint) AS fee_cents,
    COALESCE(f.discount_cents, 0::bigint) AS discount_cents,
    COALESCE(f.scholarship_cents, 0::bigint) AS scholarship_cents,
    COALESCE(c.coupon_cents, 0::bigint) AS coupon_cents,
    COALESCE(p.paid_cents, 0::bigint) - COALESCE(rf.refunded_cents, 0::bigint) AS paid_cents,
    COALESCE(f.fee_cents, 0::bigint)
      - COALESCE(f.discount_cents, 0::bigint)
      - COALESCE(f.scholarship_cents, 0::bigint)
      - COALESCE(c.coupon_cents, 0::bigint)
      - (COALESCE(p.paid_cents, 0::bigint) - COALESCE(rf.refunded_cents, 0::bigint)) AS balance_cents,
    -- Appended, not inserted: CREATE OR REPLACE VIEW may only add columns at
    -- the end. Renaming or reordering needs a DROP, which every dependent
    -- object would feel.
    COALESCE(rf.refunded_cents, 0::bigint) AS refunded_cents
   FROM registrations r
     LEFT JOIN ( SELECT rp.registration_id,
            sum(rp.fee_cents) AS fee_cents,
            sum(rp.discount_cents) AS discount_cents,
            sum(rp.scholarship_cents) AS scholarship_cents
           FROM registration_participants rp
          WHERE rp.status <> 'cancelled'::text
          GROUP BY rp.registration_id) f ON f.registration_id = r.id
     LEFT JOIN ( SELECT cr.registration_id,
            sum(cr.applied_cents) AS coupon_cents
           FROM coupon_redemptions cr
          GROUP BY cr.registration_id) c ON c.registration_id = r.id
     LEFT JOIN ( SELECT pm.registration_id,
            sum(pm.amount_cents) AS paid_cents
           FROM payments pm
          WHERE pm.status = ANY (ARRAY['succeeded'::text, 'processing'::text])
          GROUP BY pm.registration_id) p ON p.registration_id = r.id
     LEFT JOIN ( SELECT pr.registration_id,
            sum(pr.amount_cents) AS refunded_cents
           FROM payment_refunds pr
          WHERE pr.status = ANY (ARRAY['succeeded'::text, 'pending'::text])
          GROUP BY pr.registration_id) rf ON rf.registration_id = r.id;

comment on view public.registration_balances is
  'Fees minus discounts, scholarships, coupons and net payments. paid_cents is payments in MINUS refunds out (0038), so a refunded family owes again. security_invoker keeps every row behind the caller''s own RLS.';
