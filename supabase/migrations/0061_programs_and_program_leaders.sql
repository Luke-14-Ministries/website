-- ---------------------------------------------------------------------
-- 0061 — Programs, and the people who lead them
--
-- WHY THIS EXISTS. Camp is not one room. Everybody who attends is placed
-- into a program — children, nursery, youth, young adults, men, women —
-- and each program has a leader who needs to know who is in theirs. The
-- system had no idea this structure existed: it knew events, activities
-- and rooms, but not the grouping that camp actually organises people by.
-- Raised by Ellen Odom's notes, 26 August 2026; scoped with Lawrence,
-- 29 August 2026.
--
-- A PROGRAM IS NOT AN ACTIVITY. `activities` are things a person signs up
-- to do (rafting, crafts) with slots and capacity, chosen by the family.
-- A program is who a person belongs with for the week, chosen by staff.
-- Same person, two different questions, so two different tables.
--
-- WHAT A PROGRAM LEADER MAY SEE — decided 29 August 2026, and the point
-- of the whole design. A leader sees, for their own program at their own
-- event: preferred name, name, age, camp role, and their buddy. Plus a
-- BOOLEAN allergy flag — `has_allergies`, never `allergy_detail`.
--
-- That last distinction is deliberate and should not be "fixed" later by
-- someone who finds the flag unhelpful. A leader needs to know to ask;
-- they do not need a child's medical text sitting in a browser tab for a
-- season. Detail stays with the coordinator, and where a leader genuinely
-- needs it -- the camp nurse, a one-to-one carer -- the existing
-- `event_medical_access` grant already covers it: same data, narrower
-- door, expires by itself.
--
-- Room assignment is deliberately NOT included. It was considered and
-- Lawrence's answer was that a program leader does not need to know where
-- a family sleeps.
--
-- WHO ASSIGNS. Staff only, from the roster. Families never choose a
-- program and never see one. A leader cannot move a person into or out of
-- their own program either -- that is a coordinator's decision, and
-- making it so means the roster is always the single answer to "where is
-- this child meant to be?"
--
-- APPLIED to production on 2026-08-29.
-- ---------------------------------------------------------------------

-- 1. The programs themselves ------------------------------------------
-- Standing, not per-event: "Youth" is the same idea in July as it is in
-- September. `sort_order` exists because these have a natural order
-- (nursery, children, youth, young adults, men, women) that is neither
-- alphabetical nor creation order, and every roster and dropdown should
-- show them the same way round.
create table if not exists public.programs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  sort_order   integer not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.programs is
  'The standing groups camp organises people into (children, youth, women...). Staff assign; families never see these.';

insert into public.programs (name, description, sort_order) values
  ('Nursery',       'Infants and toddlers, with dedicated childcare volunteers.', 10),
  ('Children',      'Elementary-age campers.',                                    20),
  ('Youth',         'Middle and high school campers.',                            30),
  ('Young Adults',  'Post-high-school campers.',                                  40),
  ('Men',           'Adult men attending as campers or family members.',          50),
  ('Women',         'Adult women attending as campers or family members.',        60)
on conflict (name) do nothing;

-- 2. Placing a person in a program for one event ----------------------
-- The assignment hangs off `registration_participants` -- the row that
-- already means "this person, at this event" -- rather than off `people`.
-- A twelve-year-old is in Youth this July and Young Adults in two years'
-- time, and last July's roster should still say Youth.
alter table public.registration_participants
  add column if not exists program_id uuid references public.programs (id) on delete set null;

create index if not exists registration_participants_program_idx
  on public.registration_participants (program_id);

comment on column public.registration_participants.program_id is
  'Which program this person is in FOR THIS EVENT. Set by staff from the roster; null means not yet placed.';

-- 3. Who leads which program, at which event --------------------------
-- Event-scoped on purpose, and the reasoning is the same as
-- `event_medical_access`: someone who leads Youth for a week in July
-- should not still be able to read a roster the following February. A
-- leader is a `profiles` row, not necessarily a `staff` row -- most
-- program leaders are volunteers, and giving them a staff record would
-- hand them the whole admin side.
create table if not exists public.program_leaders (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  program_id   uuid not null references public.programs (id) on delete cascade,
  event_id     uuid not null references public.events (id)   on delete cascade,
  granted_by   uuid references public.profiles (id),
  granted_at   timestamptz not null default now(),
  active       boolean not null default true,
  unique (profile_id, program_id, event_id)
);

create index if not exists program_leaders_lookup_idx
  on public.program_leaders (profile_id, event_id) where active;

comment on table public.program_leaders is
  'A person may read the roster of ONE program at ONE event. Not a staff role: leaders see their program list and nothing else.';

-- 4. Am I a leader of this program, at this event? --------------------
create or replace function public.leads_program(p_program_id uuid, p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.program_leaders pl
    where pl.profile_id = auth.uid()
      and pl.program_id = p_program_id
      and pl.event_id   = p_event_id
      and pl.active
  );
$$;

-- 5. The one thing a leader can actually read -------------------------
-- A VIEW rather than table access, because the whole design is about
-- WHICH COLUMNS a leader gets. `has_allergies` is a boolean here and
-- `allergy_detail` is not selected at all -- it cannot leak through a
-- forgotten filter because it is not in the view.
--
-- DELIBERATELY security DEFINER (the default), NOT security_invoker, and
-- this is the crux of the whole design rather than an oversight. The view
-- joins `people` and `person_support`. Under security_invoker a leader
-- would need their own RLS read on those tables -- and a policy wide
-- enough to feed this view is a policy wide enough to let the same leader
-- select `allergy_detail`, `behaviour_triggers` and `medications`
-- directly, which is exactly what we are trying not to do. So the row
-- filter lives INSIDE the view instead (the WHERE at the bottom), the
-- leader is granted the view and nothing else, and the narrative columns
-- are unreachable because no policy anywhere lets a leader read them.
--
-- Supabase's advisor will flag this as a security-definer view. It is
-- correct to flag it in general and wrong here; do not "fix" it by
-- flipping the flag without also granting table reads, which would
-- undo the point.
create or replace view public.program_roster as
  select
    rp.id                       as participant_id,
    rp.registration_id,
    rp.person_id,
    rp.program_id,
    r.event_id,
    coalesce(nullif(p.preferred_name, ''), p.first_name) as display_name,
    p.first_name,
    p.last_name,
    p.date_of_birth,
    rp.camp_role,
    coalesce(ps.has_allergies, false)         as has_allergies,
    coalesce(ps.buddy_required, false)        as buddy_required,
    -- A single "there is something to ask about" flag, built from the
    -- operational booleans only. None of the narrative columns
    -- (disabilities, medications, behaviour_triggers...) is read here,
    -- and none should be added: the whole point of this view is that a
    -- leader learns to ask the coordinator, not to read the file.
    coalesce(ps.has_seizures or ps.has_rescue_medication
             or ps.has_sleep_disturbance or ps.has_caregiver, false) as has_support_needs,
    buddy_person.first_name || ' ' || buddy_person.last_name as buddy_name
  from public.registration_participants rp
  join public.registrations r  on r.id = rp.registration_id
  join public.people p         on p.id = rp.person_id
  left join public.person_support ps on ps.person_id = rp.person_id
  -- buddy_assignments joins participant to participant, not person to
  -- person, and a closed-out pairing has ended_at set.
  left join public.buddy_assignments ba
         on ba.camper_participant_id = rp.id
        and ba.event_id = r.event_id
        and ba.ended_at is null
  left join public.registration_participants buddy_rp on buddy_rp.id = ba.buddy_participant_id
  left join public.people buddy_person on buddy_person.id = buddy_rp.person_id
  -- The row filter. Staff see every program; a leader sees only the
  -- program they lead at the event they lead it at; everybody else --
  -- including a signed-in family -- sees nothing at all.
  where public.is_staff()
     or public.leads_program(rp.program_id, r.event_id);

comment on view public.program_roster is
  'What a program leader may see: who is in the program, their buddy, and a FLAG for allergies or support needs -- never the detail. Detail stays with the coordinator (see event_medical_access).';

-- 6. Row-level security ------------------------------------------------
alter table public.programs        enable row level security;
alter table public.program_leaders enable row level security;

-- Programs are a lookup list. Any signed-in staff member or leader may
-- read the names; only an admin may change them.
drop policy if exists programs_read on public.programs;
create policy programs_read on public.programs
  for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.program_leaders pl
               where pl.profile_id = auth.uid() and pl.active)
  );

drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- A leader may see their own grant, so the app can tell them what they
-- lead. Staff may see and manage all of them.
drop policy if exists program_leaders_read on public.program_leaders;
create policy program_leaders_read on public.program_leaders
  for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

drop policy if exists program_leaders_write on public.program_leaders;
create policy program_leaders_write on public.program_leaders
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- NOTE what is deliberately absent: there is NO new policy on
-- `registration_participants`, `people` or `person_support`. A program
-- leader gets no direct read of any table -- only `program_roster`, whose
-- columns are the whole permission. An earlier draft of this migration
-- did add a policy on registration_participants; it was removed, because
-- a leader who can select the participant row can select everything on
-- it, and "which columns" was the entire question.

-- 7. GRANTs --------------------------------------------------------------
-- Learned the hard way in 0054: service_role bypasses RLS but NOT table
-- grants, and a missing grant fails silently inside a webhook that then
-- returns 200. Grant explicitly, every time.
grant select, insert, update, delete on public.programs        to authenticated, service_role;
grant select, insert, update, delete on public.program_leaders to authenticated, service_role;
grant select on public.program_roster to authenticated, service_role;
