-- 0025_giving_opt_in_and_recent_account_count.sql  (applied to production 21 Aug 2026)
--
-- Giving becomes an explicit grant for EVERYONE, admins included -- same
-- policy as Sensitive, and for the same reason: the checkbox is not a barrier
-- against the person (an admin can self-grant in one click), it is protection
-- for the room. An admin running without the grant has safe screens to
-- project or share, and the ministry keeps a short, nameable answer to "who
-- can see donor giving records?".

-- Current active admins keep their access via an explicit flag, so nothing
-- changes out from under anyone mid-session; unchecking the box is now a
-- meaningful act for them too.
update public.staff set can_view_giving = true where role = 'admin' and active;

create or replace function public.can_manage_giving()
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
      and s.can_view_giving
  );
$$;

-- Count of accounts created in the last p_days days, for the amber badge on
-- the Accounts nav item. auth.users is not client-readable, hence SECURITY
-- DEFINER with the same is_admin() gate as the rest of the accounts tooling.
create or replace function public.admin_recent_account_count(p_days integer default 7)
returns integer
language plpgsql
stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    return 0;
  end if;
  return (
    select count(*)::integer from auth.users u
    where u.created_at > now() - make_interval(days => greatest(p_days, 1))
  );
end;
$$;

revoke all on function public.admin_recent_account_count(integer) from public, anon;
grant execute on function public.admin_recent_account_count(integer) to authenticated;
