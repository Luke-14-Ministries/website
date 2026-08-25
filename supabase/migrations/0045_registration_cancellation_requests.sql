-- 0045 — a family can ask to cancel; staff decide and act.
--
-- WHY A REQUEST RATHER THAN A BUTTON THAT CANCELS
-- Lawrence, 25 Aug: cancelling was blocked on the board's refund rule. It is
-- not, once the two are separated. A family can ASK to cancel with no refund
-- policy in existence — staff receive it and settle the money by whatever
-- policy applies. That unblocks the thing families actually need (a way to
-- say "we can't come") without the site inventing a rule nobody has made.
--
-- It is also the safer shape. Cancelling releases a place and may forfeit
-- money; that is not an action to hand a family behind a confirm dialog at
-- eleven at night. A request is reversible right up until staff act on it.
--
-- participant_ids EMPTY means the whole registration. Families cancel one
-- child far more often than the whole family, and a request that cannot say
-- "just Sarah" would be answered by a phone call instead — which is the thing
-- this exists to avoid.
--
-- APPLIED to the production project on 25 Aug 2026, and verified there
-- (default status, bad-status refusal, empty-array semantics).

create table if not exists public.registration_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  -- Empty array = the whole registration. Named people otherwise.
  participant_ids uuid[] not null default '{}',
  reason text,
  status text not null default 'open'
    check (status in ('open', 'actioned', 'declined', 'withdrawn')),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.registration_cancellation_requests is
  'A family asking to cancel places. Deliberately a REQUEST, not an action: cancelling releases a place and may forfeit money, so staff decide. Separating it from the refund rule is what let it be built before the board settled that rule.';
comment on column public.registration_cancellation_requests.participant_ids is
  'Empty = the whole registration. Otherwise the specific people to cancel — families cancel one child far more often than everyone.';

create index if not exists cancellation_requests_reg_idx
  on public.registration_cancellation_requests (registration_id);
-- Partial index on the open ones: that is the query the staff badge runs on
-- every admin page load, and it should stay cheap as history accumulates.
create index if not exists cancellation_requests_open_idx
  on public.registration_cancellation_requests (status) where status = 'open';

alter table public.registration_cancellation_requests enable row level security;

drop policy if exists cancellation_requests_select on public.registration_cancellation_requests;
create policy cancellation_requests_select on public.registration_cancellation_requests
  for select using (
    public.is_staff()
    or registration_id in (
      select r.id from public.registrations r
      where r.household_id in (select public.my_household_ids())
    )
  );

-- A family may raise one against their own registration.
drop policy if exists cancellation_requests_insert on public.registration_cancellation_requests;
create policy cancellation_requests_insert on public.registration_cancellation_requests
  for insert with check (
    registration_id in (
      select r.id from public.registrations r
      where r.household_id in (select public.my_household_ids())
    )
  );

-- Staff settle them. A family may also touch their own STILL-OPEN request, so
-- they can withdraw it — the action layer only ever sets 'withdrawn', and this
-- policy makes sure they cannot reach one staff have already handled.
drop policy if exists cancellation_requests_update on public.registration_cancellation_requests;
create policy cancellation_requests_update on public.registration_cancellation_requests
  for update using (
    public.is_registrar()
    or (
      status = 'open'
      and registration_id in (
        select r.id from public.registrations r
        where r.household_id in (select public.my_household_ids())
      )
    )
  ) with check (
    public.is_registrar()
    or (
      status in ('open', 'withdrawn')
      and registration_id in (
        select r.id from public.registrations r
        where r.household_id in (select public.my_household_ids())
      )
    )
  );

grant select, insert, update on public.registration_cancellation_requests to authenticated;
