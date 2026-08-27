-- 0058_background_check_access_and_grant_log.sql
--
-- Two things asked for on 26 Aug, and the second is the one that matters.
--
-- 1. BACKGROUND CHECKS BECOME THEIR OWN PERMISSION
--
-- They were gated on is_registrar(), which is the role that runs the whole
-- volunteers page. Whether somebody was screened -- and what came back -- is a
-- different kind of knowledge from a camper's medications, and the set of
-- people who need each is not the same. So it joins can_view_sensitive and
-- can_view_giving as a third explicit grant.
--
-- Administrators are backfilled to true. Without that the volunteers page goes
-- blank for everyone the moment the policy changes, including whoever is meant
-- to hand the permission out. Everybody else is explicit, admins included on
-- any new account.
--
-- 2. EVERY GRANT IS RECORDED, INCLUDING ONE MADE TO YOURSELF
--
-- There was no record of access changes at all. Somebody could grant
-- themselves sight of medical detail, giving history or background checks and
-- nothing anywhere would show it. That is the gap this closes.
--
-- staff_access_log is written by trigger only. There is no insert policy and
-- no delete policy, so it cannot be written directly or tidied up afterwards
-- -- an audit trail somebody can edit is not one.
--
-- changed_by_self is indexed on its own. Self-granting is NOT forbidden: an
-- administrator legitimately has to be able to, and a system that made it
-- impossible would just be worked around. It is simply the single entry most
-- worth being able to find later, so finding it is made cheap.

alter table public.staff
  add column if not exists can_view_background_checks boolean not null default false;

update public.staff set can_view_background_checks = true where role = 'admin';

create or replace function public.can_view_background_checks()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
      and s.can_view_background_checks
  );
$$;

grant execute on function public.can_view_background_checks() to authenticated;

create table if not exists public.staff_access_log (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.profiles(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references public.profiles(id),
  changed_by_self boolean not null default false,
  changed_at timestamptz not null default now()
);

create index if not exists staff_access_log_staff_idx
  on public.staff_access_log (staff_profile_id, changed_at desc);
create index if not exists staff_access_log_self_idx
  on public.staff_access_log (changed_at desc) where changed_by_self;

alter table public.staff_access_log enable row level security;

drop policy if exists staff_access_log_admin_read on public.staff_access_log;
create policy staff_access_log_admin_read on public.staff_access_log
  for select to authenticated
  using (public.is_admin());

create or replace function public.log_staff_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_tracked text[] := array['role','can_view_sensitive','can_view_giving',
                            'can_view_background_checks','active'];
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  v_new := to_jsonb(new);
  v_old := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;

  foreach k in array v_tracked loop
    if (v_old ->> k) is distinct from (v_new ->> k) then
      -- A brand-new staff row starts at the defaults; recording "was granted
      -- registrar" and "was granted nothing" for every new person would bury
      -- the entries that matter. Anything ABOVE the default on creation is
      -- still logged, because that is a grant made at the moment of creation.
      if tg_op = 'INSERT'
         and (v_new ->> k) in ('false', 'registrar')
      then
        continue;
      end if;
      insert into public.staff_access_log
        (staff_profile_id, field, old_value, new_value, changed_by, changed_by_self)
      values (new.profile_id, k, v_old ->> k, v_new ->> k, v_actor,
              v_actor is not null and v_actor = new.profile_id);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists staff_access_logged on public.staff;
create trigger staff_access_logged
  after insert or update on public.staff
  for each row
  execute function public.log_staff_access_change();

drop policy if exists person_clearances_staff on public.person_clearances;
create policy person_clearances_staff on public.person_clearances
  for all to authenticated
  using (public.can_view_background_checks())
  with check (public.can_view_background_checks());

comment on table public.staff_access_log is
  'Every change to what a staff member may see or do: role, the three sensitive flags, and whether their account is active. Append-only by trigger; nobody can write it directly and there is no delete policy. Admin-readable only.';

comment on column public.staff_access_log.changed_by_self is
  'TRUE when a person changed their OWN access. Not forbidden -- an administrator legitimately has to be able to -- but it is the single entry most worth being able to find later, so it is indexed on its own.';

comment on column public.staff.can_view_background_checks is
  'Background-check records are their own permission, separate from can_view_sensitive. Knowing someone was screened, and what came back, is a different kind of knowledge from knowing their medical needs, and the set of people who need each is not the same.';
