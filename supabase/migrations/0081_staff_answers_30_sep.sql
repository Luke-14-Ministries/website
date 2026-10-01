-- 0081_staff_answers_30_sep.sql
--
-- Lawrence's answers to the staff questions PDF, 30 September 2026
-- (project doc claude/decisions-2026-09-30-lawrence.md; DECISIONS.md).
--
--   A. Family discount: the 3rd and every later person on a registration
--      (camper or volunteer) gets $50 off. Its own column, like 0080's early
--      discount, so the three automatic discounts -- both-weeks (0070),
--      early registration (0080) and this one -- can never overwrite each
--      other. All three stack, each capped at what the person still owes.
--   B. The money guard (0080) protects the new column too.
--   C. The balance counts it.
--   D. Volunteers arrive a day early for orientation (2027 camp weeks).
--   E. Agreements: version 2 of the four event agreements names the event
--      ({{event}}, filled in by the website); the scholarship and check
--      agreements are retired; the Creed affirmation gets Lawrence's wording.
--      Signatures are now given PER PERSON (the website writes one row per
--      person per agreement) -- nothing in the schema had to change for that:
--      agreement_signatures has always allowed person_id rows.
--   F. registration_review: the three classes staff review registrations in,
--      plus the things that flag a registration for a second look.
--   G. Data deletion requests from the family dashboard.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- A. The family discount
-- ---------------------------------------------------------------------------

alter table public.registration_participants
  add column if not exists family_discount_cents integer not null default 0
    check (family_discount_cents >= 0);

comment on column public.registration_participants.family_discount_cents is
  'Family discount on this row ($50 for the 3rd and later person on a registration, Lawrence 30 Sep 2026). Written ONLY by recalc_family_discount(); never set by hand.';

create or replace function public.recalc_family_discount(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULE. Change these two lines and nothing else.
  c_from_person  constant int := 3;      -- the 3rd person and every one after
  c_amount_cents constant int := 5000;   -- $50 each
begin
  if p_registration_id is null then return; end if;

  update public.registration_participants
     set family_discount_cents = 0
   where registration_id = p_registration_id
     and family_discount_cents <> 0;

  -- One place per PERSON (a parent who is also volunteering holds a zero-fee
  -- second row, 0069, and is one person), counted in the order they joined
  -- the registration. Only fee-bearing places, never cancelled ones.
  with people_in_order as (
    select distinct on (rp.person_id)
           rp.id, rp.person_id, rp.created_at,
           greatest(0, rp.fee_cents - rp.discount_cents - rp.scholarship_cents
                       - rp.early_discount_cents) as owes
      from public.registration_participants rp
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and rp.fee_cents > 0
     order by rp.person_id, rp.fee_cents desc, rp.created_at, rp.id
  ),
  ranked as (
    select id, owes, row_number() over (order by created_at, id) as n
      from people_in_order
  )
  update public.registration_participants rp
     set family_discount_cents = least(c_amount_cents, r.owes)
    from ranked r
   where rp.id = r.id
     and r.n >= c_from_person
     and r.owes > 0;
end;
$$;

revoke execute on function public.recalc_family_discount(uuid) from public, anon;
grant execute on function public.recalc_family_discount(uuid) to authenticated, service_role;

-- The early discount's cap now also leaves room for the family discount, so
-- the two together never take a person below $0. Otherwise as 0080.
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
               greatest(0, rp.fee_cents - rp.discount_cents - rp.scholarship_cents
                           - rp.family_discount_cents))::int
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

revoke execute on function public.early_discount_candidates(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. The money guard covers the new column (otherwise exactly 0080's)
-- ---------------------------------------------------------------------------

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
    select eo.fee_cents, eo.participant_role, eo.event_id into v_opt
      from public.event_options eo where eo.id = new.event_option_id;
    if v_opt.event_id is distinct from
       (select r.event_id from public.registrations r where r.id = new.registration_id) then
      raise exception 'That option is not part of this event.' using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and v_opt.participant_role is distinct from new.camp_role then
      raise exception 'That option is only for the % role.', v_opt.participant_role using errcode = '42501';
    end if;
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
    new.fee_cents             := coalesce(v_opt.fee_cents, 0);
    new.discount_cents        := 0;
    new.discount_reason       := null;
    new.scholarship_cents     := 0;
    new.early_discount_cents  := 0;
    new.family_discount_cents := 0;
    new.created_at            := now();
    return new;
  end if;

  if new.fee_cents             is distinct from old.fee_cents
  or new.discount_cents        is distinct from old.discount_cents
  or new.discount_reason       is distinct from old.discount_reason
  or new.scholarship_cents     is distinct from old.scholarship_cents
  or new.early_discount_cents  is distinct from old.early_discount_cents
  or new.family_discount_cents is distinct from old.family_discount_cents
  or new.event_option_id       is distinct from old.event_option_id
  or new.registration_id       is distinct from old.registration_id
  or new.person_id             is distinct from old.person_id
  or new.created_at            is distinct from old.created_at then
    raise exception 'Fees, discounts and registration dates are set by the ministry, not from a family account.'
      using errcode = '42501';
  end if;

  if new.camp_role is distinct from old.camp_role
     and exists (select 1 from public.event_options eo
                  where eo.id = old.event_option_id and eo.participant_role is not null) then
    raise exception 'That place is for a set role and cannot be changed from a family account.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. The balance counts the family discount
-- ---------------------------------------------------------------------------
-- discount_cents in the view means ALL discounts, as in 0080. The new column
-- is appended at the end.

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
       coalesce(f.early_discount_cents, 0::bigint) as early_discount_cents,
       coalesce(f.family_discount_cents, 0::bigint) as family_discount_cents
  from registrations r
  left join (
    select rp2.registration_id,
           sum(rp2.fee_cents) as fee_cents,
           sum(rp2.discount_cents + rp2.early_discount_cents + rp2.family_discount_cents) as discount_cents,
           sum(rp2.scholarship_cents) as scholarship_cents,
           sum(rp2.early_discount_cents) as early_discount_cents,
           sum(rp2.family_discount_cents) as family_discount_cents
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

-- Existing registrations earn the family discount now.
do $$
declare r record;
begin
  for r in select id from public.registrations loop
    perform public.recalc_family_discount(r.id);
    perform public.recalc_early_registration_discount(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- D. Volunteers arrive a day early (orientation)
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists volunteer_arrives_on date;

comment on column public.events.volunteer_arrives_on is
  'The day volunteers arrive, when it differs from starts_on (Camp Celebrate: one day earlier, for orientation -- Lawrence 30 Sep 2026). NULL = same as starts_on.';

update public.events
   set volunteer_arrives_on = starts_on - 1
 where event_type = 'camp_week'
   and starts_on >= date '2027-01-01'
   and volunteer_arrives_on is null;

-- ---------------------------------------------------------------------------
-- E. Agreements
-- ---------------------------------------------------------------------------
-- New versions, never edits: every signature already given points at the
-- words its signer read. {{event}} is filled in by the website with the
-- event's name and dates ("Camp Celebrate, July 19–23, 2027").

insert into public.agreements (key, version, title, body, delivery, active)
select v.key, 2, v.title, v.body, 'internal_document', true
  from (values
    ('emergency_consent', 'Emergency Consent',
     'I acknowledge that I (as well as any family members attending) am voluntarily attending {{event}}, sponsored by Luke 14 Ministries. I understand that attendance involves some degree of risk. I release Luke 14 Ministries, the event facility, employees, volunteers, and partner organizations from any and all claims or liability arising from participation. I consent to myself (as well as any family members) receiving first aid treatment for minor injuries if necessary. In the event of an emergency, event leaders will make every effort to contact the emergency contact I have provided. If they cannot be reached, I give permission to the adult leader in charge to take any necessary action to secure appropriate treatment for the safety and health of myself and/or my family members.'),
    ('hold_harmless', 'Hold Harmless Agreement',
     'I agree to indemnify, defend, and hold harmless Luke 14 Ministries, its officers, directors, employees, agents, volunteers, event facilities, and partner organizations from any and all claims or liability arising out of my participation in {{event}}.'),
    ('event_rules', 'Event Rules',
     'I understand that, in order for everyone to experience a sense of peace and relaxation, {{event}} is an alcohol-free, drug-free, smoke-free, and weapon-free environment. I understand that cell service is limited and that cell phone use is discouraged, except in necessary situations.'),
    ('communication_consent', 'Communication Consent',
     'I consent for the leaders of {{event}} to share relevant information from my registration with other leaders and volunteers in order to provide the best possible care and support for my family.')
  ) as v(key, title, body)
 where not exists (select 1 from public.agreements a where a.key = v.key and a.version = 2);

-- Requirements follow the new versions; the old versions stop being offered.
update public.agreement_requirements req
   set agreement_id = a2.id
  from public.agreements a1
  join public.agreements a2 on a2.key = a1.key and a2.version = 2
 where req.agreement_id = a1.id
   and a1.version = 1
   and a1.key in ('emergency_consent', 'hold_harmless', 'event_rules', 'communication_consent');

update public.agreements
   set active = false
 where version = 1
   and key in ('emergency_consent', 'hold_harmless', 'event_rules', 'communication_consent');

-- Retired outright (Lawrence: "get rid of both"). Scholarship requests carry
-- no agreement; the check-mailing instructions already live on the pay panel.
update public.agreements
   set active = false
 where key in ('scholarship_agreement', 'payment_by_check');

-- The Creed affirmation, version 2: Lawrence's framing paragraph, then the
-- Creed exactly as version 1 set it. Not affirming still never blocks a
-- volunteer -- it flags the application for staff (0075).
insert into public.agreements (key, version, title, body, delivery, active)
select 'apostles_creed', 2, a.title,
       'We are running this camp in response to the instructions of Jesus Christ, and we ask that all volunteers affirm the Apostles'' Creed. If you are uncomfortable doing that, please contact Larry at larry@luke14ministries.net.'
         || substring(a.body from position(E'\n\n' in a.body)),
       'internal_document', true
  from public.agreements a
 where a.key = 'apostles_creed' and a.version = 1
   and not exists (select 1 from public.agreements b where b.key = 'apostles_creed' and b.version = 2);

update public.agreements set active = false where key = 'apostles_creed' and version = 1;

-- ---------------------------------------------------------------------------
-- F. The review classes
-- ---------------------------------------------------------------------------
-- review_class (Lawrence, 30 Sep 2026):
--   deposit_paid      confirmed money received (status 'succeeded' -- a bank
--                     transfer still clearing does not count yet). Staff review.
--   full_scholarship  no money yet, and scholarship requests cover everything
--                     owed. Staff reach out to the family.
--   neither           staff need not review; the details are kept.
-- flags: reasons a registration needs a second look whatever its class.

create or replace view public.registration_review
with (security_invoker = on)
as
with live as (
  select rp.registration_id, rp.id, rp.person_id, rp.camp_role, rp.fee_cents,
         greatest(0, rp.fee_cents - rp.discount_cents - rp.early_discount_cents
                     - rp.family_discount_cents) as owes
    from public.registration_participants rp
   where rp.status <> 'cancelled'
),
heads as (
  select registration_id, count(distinct person_id) filter (where fee_cents > 0) as fee_people
    from live group by registration_id
),
confirmed as (
  select pm.registration_id,
         sum(pm.amount_cents) - coalesce((select sum(pr.amount_cents) from public.payment_refunds pr
                                           where pr.registration_id = pm.registration_id
                                             and pr.status = 'succeeded'), 0) as cents
    from public.payments pm
   where pm.status = 'succeeded'
   group by pm.registration_id
),
sch as (
  select l.registration_id,
         sum(l.owes) as owes,
         sum(case when s.id is null then 0
                  else least(l.owes, coalesce(s.requested_cents, l.owes)) end) as requested
    from live l
    left join public.scholarships s
      on s.registration_participant_id = l.id and s.status in ('requested', 'granted')
   where l.fee_cents > 0
   group by l.registration_id
),
media_no as (
  select l.registration_id, count(distinct l.person_id) as n
    from live l
    join lateral (
      select pc.granted from public.person_consents pc
       where pc.person_id = l.person_id and pc.kind = 'media'
       order by pc.recorded_at desc limit 1
    ) m on true
   where m.granted = false
   group by l.registration_id
),
creed_no as (
  select l.registration_id, count(*) as n
    from live l
    left join public.volunteer_applications va on va.registration_participant_id = l.id
   where l.camp_role = 'volunteer'
     and coalesce(va.creed_affirmed, false) = false
   group by l.registration_id
)
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(c.cents, 0) as confirmed_paid_cents,
       coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0) as deposit_expected_cents,
       case
         when coalesce(c.cents, 0) > 0 then 'deposit_paid'
         when coalesce(s.owes, 0) > 0 and coalesce(s.requested, 0) >= s.owes then 'full_scholarship'
         else 'neither'
       end as review_class,
       array_remove(array[
         case when coalesce(c.cents, 0) > 0
               and coalesce(c.cents, 0) < coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0)
              then 'deposit_short' end,
         case when coalesce(mn.n, 0) > 0 then 'media_declined' end,
         case when coalesce(cn.n, 0) > 0 then 'creed_not_affirmed' end
       ], null) as flags
  from public.registrations r
  join public.events e on e.id = r.event_id
  left join heads h on h.registration_id = r.id
  left join confirmed c on c.registration_id = r.id
  left join sch s on s.registration_id = r.id
  left join media_no mn on mn.registration_id = r.id
  left join creed_no cn on cn.registration_id = r.id;

grant select on public.registration_review to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G. Data deletion requests
-- ---------------------------------------------------------------------------
-- A family asks; staff act. Deleting is never automatic: a registration with
-- payments, signatures or a background check has records the ministry must
-- keep (retention policy: 3 years, Lawrence 30 Sep 2026), so a person decides.

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  scope text not null check (scope in ('medical', 'account_and_medical')),
  family_note text,
  status text not null default 'requested' check (status in ('requested', 'done', 'declined')),
  staff_note text,
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.data_deletion_requests enable row level security;

drop policy if exists data_deletion_requests_select on public.data_deletion_requests;
create policy data_deletion_requests_select on public.data_deletion_requests
  for select to authenticated
  using (public.is_staff() or household_id in (select public.my_household_ids()));

drop policy if exists data_deletion_requests_insert on public.data_deletion_requests;
create policy data_deletion_requests_insert on public.data_deletion_requests
  for insert to authenticated
  with check (household_id in (select public.my_household_ids())
              and requested_by = auth.uid()
              and status = 'requested'
              and handled_by is null and handled_at is null and staff_note is null);

drop policy if exists data_deletion_requests_update on public.data_deletion_requests;
create policy data_deletion_requests_update on public.data_deletion_requests
  for update to authenticated
  using (public.is_registrar()) with check (public.is_registrar());

grant select, insert, update on public.data_deletion_requests to authenticated;
grant select, insert, update on public.data_deletion_requests to service_role;
