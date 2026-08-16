-- 0010: giving records get their own permission, separate from camp payments.
--
-- Donor giving history is potentially large and sensitive in a different way
-- from camp payments: a registrar reconciling camp fees has no need to see who
-- gave what. So access to gifts is its own grant -- can_view_giving on the
-- staff row (admins have it implicitly) -- mirroring how can_view_sensitive
-- gates medical detail. The donor's own view (their gifts on their dashboard)
-- is unaffected.

alter table public.staff add column if not exists can_view_giving boolean not null default false;

create or replace function public.can_manage_giving()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
      and (s.role = 'admin' or s.can_view_giving)
  );
$$;

-- Tighten the gifts policies from "any staff" to the giving grant.
drop policy if exists gifts_select on public.gifts;
create policy gifts_select on public.gifts
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.can_manage_giving());

drop policy if exists gifts_manual_insert on public.gifts;
create policy gifts_manual_insert on public.gifts
  for insert to authenticated
  with check (public.can_manage_giving() and method in ('check', 'cash', 'other'));

drop policy if exists gifts_manual_update on public.gifts;
create policy gifts_manual_update on public.gifts
  for update to authenticated
  using (public.can_manage_giving() and method in ('check', 'cash', 'other'))
  with check (public.can_manage_giving() and method in ('check', 'cash', 'other'));
