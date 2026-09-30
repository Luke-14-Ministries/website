-- 0080_payment_plans_and_early_registration.sql
--
-- Larry's rules, 30 September 2026:
--
--   1. To FINISH registering, a family must do one of three things: pay in
--      full, set up a payment plan, or request a scholarship.
--   2. A payment plan charges a saved card or bank account automatically. The
--      deposit is the first payment; the rest is split evenly, monthly or twice
--      a month (the family chooses), with the last charge on the balance due
--      date -- two weeks before the camp week starts.
--   3. Early registration: a flat amount off per person (Camp Celebrate: $50),
--      for people registered by the event's early date, when the family is on
--      a payment plan OR has paid in full. A scholarship request alone does
--      not earn it.
--
-- What this file does:
--   A. Early-registration settings on events, and a separate per-person
--      column for the discount (so it can never collide with the both-weeks
--      discount in discount_cents, which 0070 owns).
--   B. A guard on the money columns of registration_participants. Until now a
--      family could change their own fee through the database API -- proved on
--      a scratch copy 30 Sep: an ordinary family login set a camper's
--      fee_cents to 0. The site never did it, but the API allowed it.
--   C. registration_balances counts the early discount.
--   D. Payment plans made real: status, Stripe pointers, consent, and
--      installments that can be retried. Families can READ their plan; only
--      the Stripe webhook / daily charger (service role) and registrars write.
--   E. The rules as functions: the due date, the early discount (recomputed
--      from stored facts, like 0070), the plan's charge dates, and the
--      "how is this registration being paid" view.
--
-- The balance due date is computed in TWO places: balanceDueOn() in
-- lib/events.js for the website, and balance_due_on() below for the database
-- and the daily charger. Both say "camp_week: starts_on minus 14 days". Change
-- one, change the other.

-- ---------------------------------------------------------------------------
-- A. Early-registration settings and the per-person discount column
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists early_registration_ends_on date,
  add column if not exists early_registration_discount_cents integer not null default 0
    check (early_registration_discount_cents >= 0);

comment on column public.events.early_registration_ends_on is
  'Last day (Morristown time) a person can be registered and still earn the early-registration discount. NULL = no early discount for this event. Set on the Setup page.';
comment on column public.events.early_registration_discount_cents is
  'Early-registration discount per person, in cents (Camp Celebrate: 5000). 0 = none. Earned only with a payment plan or payment in full -- see recalc_early_registration_discount().';

alter table public.registration_participants
  add column if not exists early_discount_cents integer not null default 0
    check (early_discount_cents >= 0);

comment on column public.registration_participants.early_discount_cents is
  'Early-registration discount on this row. Written ONLY by recalc_early_registration_discount(); never set by hand. Kept apart from discount_cents so the both-weeks rule (0070) and this one cannot overwrite each other.';

-- The old per-option early-bird PRICE is retired in favour of the flat
-- per-person discount above. Nothing on the family side ever read it; the
-- staff "add a person" action did, and stops in the same change.
comment on column public.event_options.early_bird_fee_cents is
  'RETIRED 30 Sep 2026 -- use events.early_registration_discount_cents. Left in place rather than dropped; nothing reads it.';
comment on column public.event_options.early_bird_ends_on is
  'RETIRED 30 Sep 2026 -- use events.early_registration_ends_on.';

-- ---------------------------------------------------------------------------
-- B. Families cannot write money columns (or the facts a discount depends on)
-- ---------------------------------------------------------------------------
--
-- Decided by WHO IS RUNNING THE STATEMENT, not by who is logged in:
--   * current_user = 'authenticated' / 'anon' is a request straight from the
--     website or the public API. Unless the person is a registrar, the money
--     columns are the database's to set, not theirs.
--   * Inside a SECURITY DEFINER rule function (recalc_*), current_user is the
--     function's owner, so the rules still work when a family's own action
--     triggers them.
-- On INSERT the fee is taken from the option -- exactly what
-- submit_family_registration already does -- and every reduction starts at 0.
-- On UPDATE a change to any money column is refused outright.

create or replace function public.guard_participant_money()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_opt record;
begin
  if current_user not in ('authenticated', 'anon') or public.is_registrar() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The option must belong to this registration's event, and an option
    -- that pins a role (0069's zero-fee volunteer row) is only for that role.
    -- Otherwise a family could register a camper on the free volunteer
    -- option, or on a cheaper event's option.
    select eo.fee_cents, eo.participant_role, eo.event_id into v_opt
      from public.event_options eo where eo.id = new.event_option_id;
    if v_opt.event_id is distinct from
       (select r.event_id from public.registrations r where r.id = new.registration_id) then
      raise exception 'That option is not part of this event.' using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and v_opt.participant_role is distinct from new.camp_role then
      raise exception 'That option is only for the % role.', v_opt.participant_role using errcode = '42501';
    end if;
    -- A role-pinned option (0069's zero-fee volunteer row) is a SECOND role:
    -- only for somebody who already holds a live place on this registration
    -- through the general, fee-bearing option.
    if v_opt.participant_role is not null and not exists (
      select 1
        from public.registration_participants rp2
        join public.event_options eo2 on eo2.id = rp2.event_option_id
       where rp2.registration_id = new.registration_id
         and rp2.person_id = new.person_id
         and rp2.status <> 'cancelled'
         and eo2.participant_role is null
    ) then
      raise exception 'A second role needs a place on the registration first.' using errcode = '42501';
    end if;
    new.fee_cents            := coalesce(v_opt.fee_cents, 0);
    new.discount_cents       := 0;
    new.discount_reason      := null;
    new.scholarship_cents    := 0;
    new.early_discount_cents := 0;
    -- "Registered early" is judged on created_at, so it is the database's
    -- clock, never the caller's.
    new.created_at           := now();
    return new;
  end if;

  if new.fee_cents            is distinct from old.fee_cents
  or new.discount_cents       is distinct from old.discount_cents
  or new.discount_reason      is distinct from old.discount_reason
  or new.scholarship_cents    is distinct from old.scholarship_cents
  or new.early_discount_cents is distinct from old.early_discount_cents
  or new.event_option_id      is distinct from old.event_option_id
  or new.registration_id      is distinct from old.registration_id
  or new.person_id            is distinct from old.person_id
  or new.created_at           is distinct from old.created_at then
    raise exception 'Fees, discounts and registration dates are set by the ministry, not from a family account.'
      using errcode = '42501';
  end if;

  -- A row on a role-pinned option keeps that role: otherwise a free
  -- volunteer row could be turned into a camper.
  if new.camp_role is distinct from old.camp_role
     and exists (select 1 from public.event_options eo
                  where eo.id = old.event_option_id and eo.participant_role is not null) then
    raise exception 'That place is for a set role and cannot be changed from a family account.'
      using errcode = '42501';
  end if;

  -- Status: a family may submit a draft, drop a draft, and a role change on a
  -- confirmed person sends it back for review (submit_family_registration).
  -- Anything else -- above all cancelling a submitted place, which takes it
  -- out of the balance -- goes through the staff-reviewed cancellation request.
  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists registration_participants_guard_money on public.registration_participants;
create trigger registration_participants_guard_money
  before insert or update on public.registration_participants
  for each row execute function public.guard_participant_money();

-- ---------------------------------------------------------------------------
-- C. The balance counts the early discount
-- ---------------------------------------------------------------------------
--
-- discount_cents in the view now means ALL discounts (both-weeks + early), so
-- every page that shows "Discount" and every balance stays right without
-- being touched. early_discount_cents is appended at the end (a replaced view
-- may only add columns at the end) for pages that want to name it.

create or replace view public.registration_balances
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(f.fee_cents, 0::bigint) as fee_cents,
       coalesce(f.discount_cents, 0::bigint) as discount_cents,
       coalesce(f.scholarship_cents, 0::bigint) as scholarship_cents,
       coalesce(c.coupon_cents, 0::bigint) as coupon_cents,
       coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint) as paid_cents,
       coalesce(f.fee_cents, 0::bigint)
         - coalesce(f.discount_cents, 0::bigint)
         - coalesce(f.scholarship_cents, 0::bigint)
         - coalesce(c.coupon_cents, 0::bigint)
         - (coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint))
         as balance_cents,
       coalesce(rf.refunded_cents, 0::bigint) as refunded_cents,
       coalesce(rp.refund_pending_cents, 0::bigint) as refund_pending_cents,
       coalesce(f.early_discount_cents, 0::bigint) as early_discount_cents
  from registrations r
  left join (
    select rp2.registration_id,
           sum(rp2.fee_cents) as fee_cents,
           sum(rp2.discount_cents + rp2.early_discount_cents) as discount_cents,
           sum(rp2.scholarship_cents) as scholarship_cents,
           sum(rp2.early_discount_cents) as early_discount_cents
      from registration_participants rp2
     where rp2.status <> 'cancelled'
     group by rp2.registration_id
  ) f on f.registration_id = r.id
  left join (
    select cr.registration_id, sum(cr.applied_cents) as coupon_cents
      from coupon_redemptions cr
     group by cr.registration_id
  ) c on c.registration_id = r.id
  left join (
    select pm.registration_id, sum(pm.amount_cents) as paid_cents
      from payments pm
     where pm.status = any (array['succeeded', 'processing'])
     group by pm.registration_id
  ) p on p.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refunded_cents
      from payment_refunds pr
     where pr.status = 'succeeded'
     group by pr.registration_id
  ) rf on rf.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refund_pending_cents
      from payment_refunds pr
     where pr.status = 'pending'
     group by pr.registration_id
  ) rp on rp.registration_id = r.id;

-- ---------------------------------------------------------------------------
-- D. Payment plans and installments
-- ---------------------------------------------------------------------------

alter table public.payment_plans
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'active', 'paused', 'failed', 'cancelled', 'completed')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists payment_method_kind text
    check (payment_method_kind is null or payment_method_kind in ('card', 'us_bank_account')),
  -- "Visa ending 4242" / "Bank account ending 6789", captured when saved, so
  -- pages can say what will be charged without asking Stripe.
  add column if not exists payment_method_label text,
  add column if not exists final_due_on date,
  -- Consent to recurring charges: the exact words shown, who agreed, when.
  add column if not exists consent_text text,
  add column if not exists consented_by uuid references public.profiles (id) on delete set null,
  add column if not exists consented_at timestamptz,
  add column if not exists activated_at timestamptz,
  -- The deposit PaymentIntent that activated the plan. A failure from some
  -- OTHER checkout (a second tab) must not undo a plan whose deposit worked.
  add column if not exists deposit_payment_intent_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  -- Staff's call when a plan is cancelled or keeps failing (agreed 30 Sep):
  -- the family keeps the early discount unless a registrar says otherwise.
  add column if not exists keeps_early_discount boolean not null default true;

comment on column public.payment_plans.status is
  'pending = checkout started, deposit not yet paid; active = charging on schedule; paused = staff paused it; failed = a charge failed three times, staff to follow up; cancelled; completed = balance reached $0.';

-- Families could write their own plan row under 0001's policy. A plan now
-- carries Stripe pointers and decides a discount, so families READ only.
drop policy if exists payment_plans_write on public.payment_plans;
create policy payment_plans_write on public.payment_plans
  for all to authenticated
  using (public.is_registrar()) with check (public.is_registrar());

alter table public.payment_installments
  drop constraint if exists payment_installments_status_check;
alter table public.payment_installments
  add constraint payment_installments_status_check
    check (status in ('scheduled', 'processing', 'failed', 'sent', 'paid', 'waived', 'cancelled'));

alter table public.payment_installments
  add column if not exists stripe_payment_intent_id text,
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text,
  -- When a failed charge is tried again. Null = on its due date.
  add column if not exists next_attempt_on date;

create unique index if not exists payment_installments_intent_uidx
  on public.payment_installments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

comment on column public.payment_installments.amount_cents is
  'An ESTIMATE shown to the family. The charger works the real amount out on the day from the live balance (balance / charges left), so a scholarship or extra payment made mid-plan shrinks later charges and the last one lands the balance on exactly $0.';

-- The daily charger and the webhook run as service_role, which needs its
-- grants spelled out (0006).
grant select, insert, update on public.payment_plans to service_role;
grant select, insert, update, delete on public.payment_installments to service_role;
-- registration_balances is a security_invoker view, so reading it needs
-- SELECT on every table underneath it as well.
grant select on public.registration_balances, public.registrations, public.events,
  public.registration_participants, public.households, public.scholarships,
  public.coupon_redemptions, public.payment_refunds, public.payments
  to service_role;

-- ---------------------------------------------------------------------------
-- E. The rules
-- ---------------------------------------------------------------------------

-- The balance due date. Mirrors balanceDueOn() in lib/events.js.
create or replace function public.balance_due_on(p_event_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case when e.event_type = 'camp_week' then e.starts_on - 14 end
    from public.events e where e.id = p_event_id;
$$;

revoke execute on function public.balance_due_on(uuid) from public, anon;
grant execute on function public.balance_due_on(uuid) to authenticated, service_role;

-- The early discount each person COULD earn on this registration, before
-- asking whether the family qualifies. One row per person (the fee-bearing
-- row -- a parent who is also volunteering has a zero-fee second row), only
-- for people registered by the early date, and never more than what that
-- person still owes after other reductions.
create or replace function public.early_discount_candidates(p_registration_id uuid)
returns table (participant_id uuid, amount_cents integer)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (rp.person_id)
         rp.id,
         least(e.early_registration_discount_cents,
               greatest(0, rp.fee_cents - rp.discount_cents - rp.scholarship_cents))::int
    from public.registration_participants rp
    join public.registrations r on r.id = rp.registration_id
    join public.events e        on e.id = r.event_id
   where rp.registration_id = p_registration_id
     and rp.status <> 'cancelled'
     and rp.fee_cents > 0
     and e.early_registration_discount_cents > 0
     and e.early_registration_ends_on is not null
     and (rp.created_at at time zone 'America/New_York')::date <= e.early_registration_ends_on
   order by rp.person_id, rp.fee_cents desc, rp.id;
$$;

-- Internal: called only from the definer functions below, which run as the
-- owner. Nobody else needs to list another family's participants.
revoke execute on function public.early_discount_candidates(uuid) from public, anon, authenticated;

-- What paying in full RIGHT NOW would cost, early discount included. The
-- "Pay in full" checkout charges this, so a family is never charged $50 a
-- head that the discount would then have to hand back.
create or replace function public.pay_in_full_amount(p_registration_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_early   bigint;
  v_pot     bigint;
begin
  -- Security definer reads every row, so check the caller may see this one.
  -- (Not current_user: inside a definer function that is always the owner.
  -- auth.uid() is null only for the service role, which may see everything;
  -- anon cannot execute this at all -- see the grants below.)
  if auth.uid() is not null
     and not public.is_staff()
     and p_registration_id not in (select public.my_registration_ids()) then
    return null;
  end if;
  select b.balance_cents, b.early_discount_cents into v_balance, v_early
    from public.registration_balances b where b.registration_id = p_registration_id;
  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  -- Balance as it would be with the full early discount in place.
  return greatest(0, coalesce(v_balance, 0) + coalesce(v_early, 0) - v_pot)::int;
end;
$$;

revoke execute on function public.pay_in_full_amount(uuid) from public, anon;
grant execute on function public.pay_in_full_amount(uuid) to authenticated, service_role;

-- The early discount, as a rule recomputed from stored facts (the 0070
-- pattern): clear it, then re-earn it. Safe to call as often as you like, and
-- called after anything that could change the answer -- a registration saved,
-- a payment recorded or failed, a plan activated or cancelled.
--
-- QUALIFIES when the person was registered by the early date AND either
--   * the registration has a payment plan that was activated and still keeps
--     the discount (a registrar can switch that off), or
--   * the family has paid everything the discounted total asks for.
create or replace function public.recalc_early_registration_discount(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pot       bigint;
  v_balance   bigint;
  v_has_plan  boolean;
begin
  if p_registration_id is null then return; end if;

  update public.registration_participants
     set early_discount_cents = 0
   where registration_id = p_registration_id
     and early_discount_cents <> 0;

  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  if v_pot = 0 then return; end if;

  select exists (
    select 1 from public.payment_plans pp
     where pp.registration_id = p_registration_id
       and pp.activated_at is not null
       and pp.keeps_early_discount
  ) into v_has_plan;

  select b.balance_cents into v_balance
    from public.registration_balances b where b.registration_id = p_registration_id;

  if v_has_plan or coalesce(v_balance, 0) - v_pot <= 0 then
    update public.registration_participants rp
       set early_discount_cents = c.amount_cents
      from public.early_discount_candidates(p_registration_id) c
     where rp.id = c.participant_id;
  end if;
end;
$$;

comment on function public.recalc_early_registration_discount(uuid) is
  'Re-applies the early-registration discount for one registration from scratch. Only ever writes early_discount_cents. Safe to call repeatedly.';

revoke execute on function public.recalc_early_registration_discount(uuid) from public, anon;
grant execute on function public.recalc_early_registration_discount(uuid) to authenticated, service_role;

-- The plan's charge dates after the deposit, ending on the due date.
--   monthly      -- counted back from the due date a month at a time, so the
--                   last charge IS the due date.
--   semi_monthly -- the 1st and 15th of each month, plus the due date itself.
-- Dates within 3 days of today are skipped (the deposit was just taken), and
-- in semi_monthly a 1st/15th within 5 days of the due date is dropped so two
-- charges never land in the same week.
create or replace function public.plan_charge_dates(p_today date, p_due date, p_schedule text)
returns setof date
language plpgsql
immutable
as $$
declare
  d date;
  k int := 0;
begin
  if p_due is null or p_due <= p_today + 3 then
    return;
  end if;
  if p_schedule = 'monthly' then
    loop
      d := (p_due - make_interval(months => k))::date;
      exit when d <= p_today + 3;
      return next d;
      k := k + 1;
    end loop;
  elsif p_schedule = 'semi_monthly' then
    return next p_due;
    for d in
      select g::date from generate_series(p_today + 4, p_due - 6, interval '1 day') g
       where extract(day from g) in (1, 15)
    loop
      return next d;
    end loop;
  else
    raise exception 'unknown plan schedule %', p_schedule;
  end if;
end;
$$;

-- (Re)build a plan's scheduled installments. Called by the webhook when the
-- deposit clears and a plan becomes active. Leaves paid/processing/failed
-- rows alone. Service role, or a registrar (checked inside).
create or replace function public.build_plan_installments(p_plan_id uuid, p_today date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.payment_plans%rowtype;
  v_due     date;
  v_balance bigint;
  v_n       int;
begin
  -- The service role (auth.uid() is null) or a registrar re-starting a
  -- paused plan from the registration page. Nobody else.
  if auth.uid() is not null and not public.is_registrar() then
    raise exception 'Only the ministry can change a payment schedule.' using errcode = '42501';
  end if;
  -- Locked: a repeated Stripe delivery and a registrar pressing Resume at the
  -- same moment must not each insert a full schedule.
  select * into v_plan from public.payment_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'no such plan'; end if;

  select public.balance_due_on(r.event_id) into v_due
    from public.registrations r where r.id = v_plan.registration_id;

  delete from public.payment_installments
   where payment_plan_id = p_plan_id and status = 'scheduled';

  select count(*) into v_n from public.plan_charge_dates(p_today, v_due, v_plan.schedule);
  select greatest(0, b.balance_cents) into v_balance
    from public.registration_balances b where b.registration_id = v_plan.registration_id;

  if v_n > 0 then
    insert into public.payment_installments (payment_plan_id, due_on, amount_cents, status)
    select p_plan_id, d, ceil(coalesce(v_balance, 0)::numeric / v_n)::int, 'scheduled'
      from public.plan_charge_dates(p_today, v_due, v_plan.schedule) d;
  end if;

  update public.payment_plans set final_due_on = v_due where id = p_plan_id;
  return v_n;
end;
$$;

revoke execute on function public.build_plan_installments(uuid, date) from public, anon;
grant execute on function public.build_plan_installments(uuid, date) to authenticated, service_role;

-- How each registration is being paid -- the "finished registering" test.
-- route:
--   plan          a plan that got past its deposit (active, paused, failed or completed)
--   paid_in_full  nothing owed and something was paid
--   nothing_owed  nothing owed and nothing paid (e.g. a zero-fee volunteer)
--   scholarship   a scholarship requested or granted for someone on it
--   none          NOT FINISHED -- the family still has to choose
create or replace view public.registration_payment_routes
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       pp.id as plan_id,
       pp.status as plan_status,
       pp.schedule as plan_schedule,
       pp.payment_method_label,
       coalesce(sch.any_request, false) as scholarship_requested,
       case
         when pp.status in ('active', 'paused', 'failed', 'completed') then 'plan'
         when coalesce(b.balance_cents, 0) <= 0 and coalesce(b.paid_cents, 0) > 0 then 'paid_in_full'
         when coalesce(b.balance_cents, 0) <= 0 then 'nothing_owed'
         when coalesce(sch.any_request, false) then 'scholarship'
         else 'none'
       end as route
  from public.registrations r
  left join public.payment_plans pp on pp.registration_id = r.id
  left join public.registration_balances b on b.registration_id = r.id
  left join lateral (
    select true as any_request
      from public.scholarships s
      join public.registration_participants rp on rp.id = s.registration_participant_id
     where rp.registration_id = r.id
       and s.status in ('requested', 'granted')
     limit 1
  ) sch on true;

grant select on public.registration_payment_routes to authenticated, service_role;
