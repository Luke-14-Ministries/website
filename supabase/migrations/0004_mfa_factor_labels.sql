-- 0004: editable nicknames for a person's own two-factor devices.
--
-- GoTrue keeps a friendly_name set at enrolment but offers no self-service
-- rename, so the editable label lives here, keyed by the factor id and owned by
-- the person. profile_id defaults to the caller and row-level security scopes
-- every row to them, so nobody can see or change anyone else's device names.

create table if not exists public.mfa_factor_labels (
  factor_id   text primary key,
  profile_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label       text not null,
  created_at  timestamptz not null default now()
);

alter table public.mfa_factor_labels enable row level security;

create policy mfa_factor_labels_select on public.mfa_factor_labels
  for select to authenticated using (profile_id = (select auth.uid()));

create policy mfa_factor_labels_insert on public.mfa_factor_labels
  for insert to authenticated with check (profile_id = (select auth.uid()));

create policy mfa_factor_labels_update on public.mfa_factor_labels
  for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

create policy mfa_factor_labels_delete on public.mfa_factor_labels
  for delete to authenticated using (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.mfa_factor_labels to authenticated;
