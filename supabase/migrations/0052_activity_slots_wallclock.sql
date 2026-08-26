-- 0052_activity_slots_wallclock.sql
--
-- Time slots for activities that run in sittings: the pontoon goes out four
-- times on the Tuesday, the salon takes one person at a time, and "who is on
-- the 2 o'clock boat" is the question the day is run from.
--
-- activity_slots has existed since 0001, unused: no UI ever wrote to it, and
-- it holds zero rows. That means this can be shaped properly rather than
-- worked around, which matters because the shape it had is subtly wrong.
--
-- WHY WALL-CLOCK, NOT TIMESTAMPTZ
--
-- starts_at/ends_at are `timestamptz` — an instant on the world's timeline.
-- That is the right type for a payment and the wrong one for this. "Tuesday at
-- 2pm" at camp means 2pm at camp: it does not shift because the coordinator
-- setting it up is sitting in Mountain time, and it does not shift if the
-- clocks change between now and July. Storing an instant forces every read and
-- write through a timezone conversion, and the failure mode is silent — a
-- boarding time an hour out, discovered at the dock.
--
-- Camp scheduling is wall-clock, so the columns are wall-clock: a date and two
-- times, meaning exactly what they say at the place the activity happens.
-- Nothing converts, so nothing can convert wrongly.
--
-- The old timestamptz columns are kept but made optional. They are unused and
-- unpopulated; leaving them costs nothing and dropping a column other code
-- might later reach for costs a migration.

begin;

alter table public.activity_slots
  -- "Boat 1", "Chair 2" — a name for the sitting where the time alone is not
  -- enough to tell two apart. Optional: most slots are just a time.
  add column if not exists label text,
  add column if not exists slot_date date,
  add column if not exists start_time time,
  add column if not exists end_time time;

alter table public.activity_slots alter column starts_at drop not null;
alter table public.activity_slots alter column ends_at drop not null;

-- Every slot from here on carries the wall-clock trio.
alter table public.activity_slots
  drop constraint if exists activity_slots_wallclock_present;
alter table public.activity_slots
  add constraint activity_slots_wallclock_present
  check (slot_date is not null and start_time is not null and end_time is not null);

alter table public.activity_slots
  drop constraint if exists activity_slots_ends_after_starts;
alter table public.activity_slots
  add constraint activity_slots_ends_after_starts
  check (end_time > start_time);

create index if not exists activity_slots_activity_when_idx
  on public.activity_slots (activity_id, slot_date, start_time);

comment on table public.activity_slots is
  'Sittings within an activity (the 2pm boat, chair 3). Times are WALL-CLOCK AT CAMP -- a date and two times of day, not instants. See 0052 for why.';

-- ---------------------------------------------------------------------------
-- Guard 1: a slot cannot be oversold.
--
-- Same shape and the same exception as the activity-level guard in 0040:
-- coordinators may exceed a cap deliberately, because camp's instinct is to
-- find a way and a hard block would make the software the thing that says no.
-- A family cannot.
create or replace function public.activity_slot_capacity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_taken int;
begin
  if new.slot_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select s.capacity into v_capacity
  from public.activity_slots s
  where s.id = new.slot_id;

  if v_capacity is null then
    return new;
  end if;

  select count(*) into v_taken
  from public.activity_signups g
  where g.slot_id = new.slot_id
    and g.status <> 'cancelled'
    and g.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_taken >= v_capacity and not public.is_coordinator() then
    raise exception 'That time is full. Please choose another, or ask camp staff -- they can often make room.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists activity_signups_slot_capacity on public.activity_signups;
create trigger activity_signups_slot_capacity
  before insert or update on public.activity_signups
  for each row
  execute function public.activity_slot_capacity_guard();

-- ---------------------------------------------------------------------------
-- Guard 2: if an activity runs in sittings, a signup has to name one.
--
-- A signup with no slot on a slotted activity is a place that cannot be
-- rostered: the family believes they are booked and no boat has them on it.
-- Interest-mode activities are exempt -- "I'd like to do this" is not a
-- booking and never needed a time.
create or replace function public.activity_signup_requires_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_slots int;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select a.booking_mode into v_mode from public.activities a where a.id = new.activity_id;
  if v_mode is distinct from 'signup' then
    return new;
  end if;

  select count(*) into v_slots
  from public.activity_slots s
  where s.activity_id = new.activity_id;

  if v_slots > 0 and new.slot_id is null then
    raise exception 'Please choose a time for this activity.'
      using errcode = 'check_violation';
  end if;

  -- And the slot has to belong to the activity being signed up for.
  if new.slot_id is not null then
    if not exists (
      select 1 from public.activity_slots s
      where s.id = new.slot_id and s.activity_id = new.activity_id
    ) then
      raise exception 'That time does not belong to this activity.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists activity_signups_require_slot on public.activity_signups;
create trigger activity_signups_require_slot
  before insert or update on public.activity_signups
  for each row
  execute function public.activity_signup_requires_slot();

-- ---------------------------------------------------------------------------
-- How many places are left, without exposing who is in them.
--
-- Families must be able to see "2 of 8 left" while RLS keeps other families'
-- signups invisible -- the same reasoning as activity_availability() in 0040,
-- which returns counts only.
create or replace function public.activity_slot_availability(p_event_id uuid)
returns table (
  slot_id uuid,
  activity_id uuid,
  slot_date date,
  start_time time,
  end_time time,
  label text,
  capacity int,
  taken int
)
language sql
security definer
set search_path = public
as $$
  select s.id,
         s.activity_id,
         s.slot_date,
         s.start_time,
         s.end_time,
         s.label,
         s.capacity,
         (select count(*)::int
            from public.activity_signups g
           where g.slot_id = s.id and g.status <> 'cancelled')
  from public.activity_slots s
  join public.activities a on a.id = s.activity_id
  where a.event_id = p_event_id
    and a.active
  order by s.slot_date, s.start_time;
$$;

grant execute on function public.activity_slot_availability(uuid) to authenticated;

commit;
