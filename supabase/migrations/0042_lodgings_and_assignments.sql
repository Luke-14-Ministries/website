-- 0042 — where everyone sleeps.
--
-- The one part of this system 0001 did not model, so the shape is a decision
-- rather than a discovery.
--
-- WHY LODGINGS NEST (parent_id)
-- Lawrence, 24 Aug: "in some cases, especially for volunteers, room assignments
-- are just cabin assignments." Both are true at once — a volunteer is put in
-- Cabin 3 and that is the whole answer, while a family is put in a particular
-- room inside the lodge. Two tables (cabins, rooms) would force every query to
-- ask "which kind is this?" and force staff to pick the right screen before
-- they can do the obvious thing. One self-referencing table lets a cabin BE a
-- place you can assign someone to, and also CONTAIN places you can assign
-- someone to. Occupancy of a cabin is then its own assignments plus its
-- children's, which is exactly how a camp director counts beds.
--
-- WHY `accessible` IS NOT A NICETY
-- This is a camp for people affected by disability. A bed assignment that
-- ignores wheelchair access is a failure, not an inconvenience, so the flag is
-- first-class and the assignment screen warns when someone with mobility notes
-- lands somewhere not marked accessible.
--
-- APPLIED to the production project on 24 Aug 2026.

create table if not exists public.lodgings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- A room inside a cabin points at the cabin. A cabin points at nothing.
  parent_id uuid references public.lodgings(id) on delete cascade,
  name text not null,
  kind text not null default 'cabin'
    check (kind in ('cabin', 'room', 'tent', 'lodge', 'offsite')),
  -- Advisory, never enforced: camps squeeze in one more and staff know why.
  capacity int check (capacity is null or capacity >= 0),
  accessible boolean not null default false,
  accessible_notes text,
  notes text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lodgings is
  'Sleeping places for one event. Self-referencing: a cabin may be assigned directly (common for volunteers) or contain rooms that are assigned instead (common for families). Occupancy of a parent counts its own assignments plus its children''s.';
comment on column public.lodgings.accessible is
  'Step-free access, accessible bathroom, room for a chair to turn. Load-bearing at this camp -- the assignment screen warns when someone with mobility notes is placed somewhere this is false.';
comment on column public.lodgings.capacity is
  'Advisory. Deliberately NOT enforced: staff exceed it knowingly, and a system that forbids what the camp director decided is a system that gets worked around.';

create index if not exists lodgings_event_idx on public.lodgings (event_id);
create index if not exists lodgings_parent_idx on public.lodgings (parent_id);

create table if not exists public.lodging_assignments (
  id uuid primary key default gen_random_uuid(),
  lodging_id uuid not null references public.lodgings(id) on delete cascade,
  registration_participant_id uuid not null
    references public.registration_participants(id) on delete cascade,
  note text,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One bed per person. A participant row is already event-specific, so this
  -- is "one place per person per event" without needing to say so.
  unique (registration_participant_id)
);

comment on table public.lodging_assignments is
  'Who sleeps where. One row per participant -- moving someone updates the row rather than adding a second.';

create index if not exists lodging_assignments_lodging_idx
  on public.lodging_assignments (lodging_id);

-- Publication gate, mirroring buddy assignments for the same reason: room
-- lists get drafted and reshuffled, and a family should not watch that happen.
alter table public.events
  add column if not exists lodging_assignments_published_at timestamptz;

create or replace function public.lodging_published(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select e.lodging_assignments_published_at is not null
     from public.events e where e.id = p_event_id),
    false);
$$;

grant execute on function public.lodging_published(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security, matching the shape used everywhere else in this schema.
-- ---------------------------------------------------------------------------
alter table public.lodgings enable row level security;
alter table public.lodging_assignments enable row level security;

drop policy if exists lodgings_select on public.lodgings;
create policy lodgings_select on public.lodgings
  for select using (public.is_staff());

drop policy if exists lodgings_write on public.lodgings;
create policy lodgings_write on public.lodgings
  for all using (public.is_coordinator()) with check (public.is_coordinator());

-- A family sees their OWN placement, and only once staff have published.
-- Written as a subquery on lodgings rather than by copying event_id onto the
-- assignment: one source of truth for which event a bed belongs to, and no
-- denormalised column to drift.
drop policy if exists lodging_assignments_select on public.lodging_assignments;
create policy lodging_assignments_select on public.lodging_assignments
  for select using (
    public.is_staff()
    or (
      exists (
        select 1 from public.lodgings l
        where l.id = lodging_assignments.lodging_id
          and public.lodging_published(l.event_id)
      )
      and registration_participant_id in (select public.my_participant_ids())
    )
  );

drop policy if exists lodging_assignments_write on public.lodging_assignments;
create policy lodging_assignments_write on public.lodging_assignments
  for all using (public.is_coordinator()) with check (public.is_coordinator());

grant select on public.lodgings to authenticated;
grant select on public.lodging_assignments to authenticated;
grant insert, update, delete on public.lodgings to authenticated;
grant insert, update, delete on public.lodging_assignments to authenticated;
