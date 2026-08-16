-- 0012: linked caregivers per person + per-event medical contact.

-- Up to two linked adults/caregivers for each person (minors and campers
-- especially). Stored as links to other people in the same household, so a
-- caregiver's phone lives in ONE place (people.phone) and never goes stale.
-- Families manage their own links; registrars can fix anything.
create table public.person_caregivers (
  person_id uuid not null references public.people (id) on delete cascade,
  caregiver_person_id uuid not null references public.people (id) on delete cascade,
  position smallint not null check (position in (1, 2)),
  created_at timestamptz not null default now(),
  primary key (person_id, position),
  unique (person_id, caregiver_person_id),
  check (person_id <> caregiver_person_id)
);

alter table public.person_caregivers enable row level security;

create policy person_caregivers_select on public.person_caregivers
  for select using (
    is_staff()
    or exists (
      select 1 from public.people p
      where p.id = person_id
        and p.household_id in (select my_household_ids())
    )
  );

-- Writes: registrars anywhere; families only within their own household, and
-- only linking caregivers who are ALSO in their household.
create policy person_caregivers_write on public.person_caregivers
  for all using (
    is_registrar()
    or exists (
      select 1 from public.people p
      where p.id = person_id
        and p.household_id in (select my_household_ids())
    )
  )
  with check (
    is_registrar()
    or (
      exists (
        select 1 from public.people p
        where p.id = person_id
          and p.household_id in (select my_household_ids())
      )
      and exists (
        select 1 from public.people c
        where c.id = caregiver_person_id
          and c.household_id in (select my_household_ids())
      )
    )
  );

-- Per-event medical contact (camp doctor / nurse). Not sensitive -- shown to
-- all staff on Check-In and Medical pages. Editable by admins (events_write).
alter table public.events
  add column if not exists medical_contact_name text,
  add column if not exists medical_contact_phone text;
