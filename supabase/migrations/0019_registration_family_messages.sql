-- 0019: brief staff notes TO the family, shown on their dashboard.
-- ("We added a $100 scholarship credit to your registration on 8/17.")
-- A separate table, not a column on registrations: families can UPDATE their
-- own registration row, and a family-writable row cannot carry a staff-only
-- column. registration_notes stays what it was — staff-internal, never shown.
-- Applied to production 17 August 2026.

create table public.registration_family_messages (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  body            text not null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index registration_family_messages_reg_idx
  on public.registration_family_messages (registration_id);

alter table public.registration_family_messages enable row level security;

-- Families read messages on their own registrations; staff read all.
create policy registration_family_messages_select
  on public.registration_family_messages
  for select to authenticated
  using (
    registration_id in (
      select r.id from public.registrations r
      where r.household_id in (
        select hm.household_id from public.household_members hm
        where hm.profile_id = (select auth.uid())
      )
    )
    or public.is_staff()
  );

-- Only registrars write or remove them.
create policy registration_family_messages_write
  on public.registration_family_messages
  for insert to authenticated
  with check (public.is_registrar());

create policy registration_family_messages_delete
  on public.registration_family_messages
  for delete to authenticated
  using (public.is_registrar());

-- Least-privilege lesson from 0016: RLS alone is not enough — the role needs
-- table grants too, or every query returns "permission denied".
grant select, insert, delete on public.registration_family_messages to authenticated;
