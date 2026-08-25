-- 0040 — how many places are left, and refusing to oversell them.
--
-- A family may only SELECT their own activity_signups (correct: who else is
-- going riding is nobody's business). But that makes "4 places left"
-- unanswerable from the client, because counting requires reading rows the
-- caller cannot see. A SECURITY DEFINER function is the narrow, deliberate
-- exception: it returns COUNTS ONLY -- never a name, never a row -- which is
-- exactly the amount of other people's data a capacity number has to reveal.
--
-- APPLIED to the production project on 24 Aug 2026.

create or replace function public.activity_availability(p_event_id uuid)
returns table (activity_id uuid, taken int)
language sql
stable
security definer
set search_path to ''
as $$
  select s.activity_id, count(*)::int as taken
  from public.activity_signups s
  join public.activities a on a.id = s.activity_id
  where a.event_id = p_event_id
    -- 'interested' is not a place held. Only a real signup consumes capacity,
    -- which is what lets an interest-mode activity be unlimited while a
    -- signup-mode one fills up.
    and s.status = 'signed_up'
  group by s.activity_id;
$$;

comment on function public.activity_availability(uuid) is
  'Per-activity count of confirmed signups for one event. SECURITY DEFINER because a family cannot read other families signups -- this returns aggregate counts only, never rows.';

grant execute on function public.activity_availability(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The capacity guard. Client-side checks are a courtesy; two families tapping
-- the last place at the same moment is exactly the case a courtesy cannot
-- handle, so the rule lives where the write happens.
--
-- Staff (coordinators) can exceed capacity deliberately -- camps do squeeze in
-- one more, and a system that forbids what the camp director has decided is a
-- system that gets worked around. Families cannot.
-- ---------------------------------------------------------------------------
create or replace function public.activity_signups_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_capacity int;
  v_mode text;
  v_taken int;
begin
  if new.status <> 'signed_up' then
    return new;
  end if;

  select a.capacity, a.booking_mode into v_capacity, v_mode
  from public.activities a where a.id = new.activity_id;

  if v_capacity is null or v_mode = 'interest' then
    return new;
  end if;

  select count(*)::int into v_taken
  from public.activity_signups s
  where s.activity_id = new.activity_id
    and s.status = 'signed_up'
    and s.id <> new.id;

  if v_taken >= v_capacity and not public.is_coordinator() then
    raise exception 'activity full';
  end if;

  return new;
end;
$$;

drop trigger if exists activity_signups_capacity_trg on public.activity_signups;
create trigger activity_signups_capacity_trg
  before insert or update on public.activity_signups
  for each row execute function public.activity_signups_capacity_guard();
