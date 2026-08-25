-- 0044 — you cannot refund more than was paid.
--
-- payment_refunds already existed, and registration_balances already nets
-- refunds off paid_cents. The gap was arithmetic: the only constraint was
-- amount_cents > 0, so a slipped decimal could refund $500 against a $50
-- payment and drive the household's balance negative — inventing a credit the
-- ministry never received, on a screen families read as authoritative.
--
-- The server action does check this in JavaScript. That check is a courtesy,
-- not a boundary: two registrars on two screens, or one impatient
-- double-click, both defeat it. The rule belongs where the write happens.
--
-- Counted against the payment's own amount PLUS its fee_cover_cents, because
-- when a payer added a few dollars to cover Stripe's cut, that money did
-- arrive and can legitimately go back.
--
-- 'failed' and 'canceled' refunds are excluded from the total: a refund that
-- did not happen must not consume the headroom for one that should.
--
-- APPLIED to the production project on 24 Aug 2026, and verified there with a
-- three-case test (partial accepted / over-refund refused / exact remainder
-- accepted) against a throwaway payment that was deleted afterwards.

create or replace function public.payment_refunds_amount_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_paid int;
  v_fee int;
  v_already int;
  v_status text;
begin
  if new.status in ('failed', 'canceled') then
    return new;
  end if;

  select p.amount_cents, coalesce(p.fee_cover_cents, 0), p.status
    into v_paid, v_fee, v_status
  from public.payments p
  where p.id = new.payment_id;

  if v_paid is null then
    raise exception 'refund references a payment that does not exist';
  end if;

  -- Refunding money that never arrived is a different mistake, and worth its
  -- own message: a failed payment has nothing to give back.
  if v_status = 'failed' then
    raise exception 'that payment failed — there is nothing to refund';
  end if;

  select coalesce(sum(r.amount_cents), 0) into v_already
  from public.payment_refunds r
  where r.payment_id = new.payment_id
    and r.status in ('pending', 'succeeded')
    and r.id <> new.id;

  if v_already + new.amount_cents > v_paid + v_fee then
    raise exception 'refund exceeds payment: % already refunded of % available',
      v_already, v_paid + v_fee
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists payment_refunds_amount_trg on public.payment_refunds;
create trigger payment_refunds_amount_trg
  before insert or update on public.payment_refunds
  for each row execute function public.payment_refunds_amount_guard();

-- What is left to give back on each payment. Staff UI reads this so the
-- number on screen and the number the trigger enforces come from one place --
-- if they ever disagree, the screen is wrong and the trigger wins, which is
-- the wrong way round for a person trying to do their job.
create or replace view public.payment_refundable as
select
  p.id as payment_id,
  p.registration_id,
  p.amount_cents,
  coalesce(p.fee_cover_cents, 0) as fee_cover_cents,
  coalesce(r.refunded_cents, 0)::int as refunded_cents,
  greatest(
    0,
    p.amount_cents + coalesce(p.fee_cover_cents, 0) - coalesce(r.refunded_cents, 0)
  )::int as refundable_cents
from public.payments p
left join (
  select payment_id, sum(amount_cents) as refunded_cents
  from public.payment_refunds
  where status in ('pending', 'succeeded')
  group by payment_id
) r on r.payment_id = p.id
where p.status <> 'failed';

-- security_invoker so the view runs as the CALLER: without it the view would
-- run as its owner and hand every family's payments to anyone who selected
-- from it. This has bitten this project before.
alter view public.payment_refundable set (security_invoker = on);

grant select on public.payment_refundable to authenticated;
