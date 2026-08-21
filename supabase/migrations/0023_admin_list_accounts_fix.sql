-- 0023_admin_list_accounts_fix.sql  (applied to production 21 Aug 2026)
--
-- Fix admin_list_accounts from 0022: Postgres has no min(uuid), so the
-- original version errored on every call -- the Accounts page showed "could
-- not be loaded" from the moment it shipped. The "pick one household + count
-- them" trick now uses array_agg ordered by membership age instead: the FIRST
-- household the person joined is the one shown, which is also the more useful
-- choice. The display name moves to its own lateral join for the same reason.

create or replace function public.admin_list_accounts()
returns table (
  user_id             uuid,
  email               text,
  first_name          text,
  last_name           text,
  created_at          timestamptz,
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz,
  mfa_factor_count    integer,
  staff_role          text,
  staff_active        boolean,
  household_id        uuid,
  household_name      text,
  household_count     integer,
  registration_count  integer,
  payment_count       integer,
  gift_count          integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may list accounts'
      using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.first_name,
    p.last_name,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    (select count(*)::integer
       from auth.mfa_factors f
      where f.user_id = u.id
        and f.status = 'verified'),
    s.role::text,
    s.active,
    hh.household_id,
    hn.display_name,
    hh.household_count,
    coalesce(rc.n, 0),
    coalesce(pc.n, 0),
    coalesce(gc.n, 0)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.staff    s on s.profile_id = u.id
  -- A profile can sit in more than one household (rare, but allowed). Show the
  -- first one they joined and report how many, rather than duplicating the
  -- person across rows.
  left join lateral (
    select
      (array_agg(m.household_id order by m.created_at))[1] as household_id,
      count(*)::integer                                    as household_count
    from public.household_members m
    where m.profile_id = u.id
  ) hh on true
  left join lateral (
    select h.display_name
    from public.households h
    where h.id = hh.household_id
  ) hn on true
  left join lateral (
    select count(*)::integer as n
    from public.registrations r
    where r.household_id in (
      select m.household_id from public.household_members m where m.profile_id = u.id
    )
  ) rc on true
  left join lateral (
    select count(*)::integer as n
    from public.payments pay
    join public.registrations r on r.id = pay.registration_id
    where r.household_id in (
      select m.household_id from public.household_members m where m.profile_id = u.id
    )
  ) pc on true
  left join lateral (
    select count(*)::integer as n
    from public.gifts g
    where g.profile_id = u.id
  ) gc on true
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_accounts() from public, anon;
grant execute on function public.admin_list_accounts() to authenticated;
