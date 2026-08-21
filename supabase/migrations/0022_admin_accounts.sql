-- 0022_admin_accounts.sql
--
-- The Accounts page (/admin/accounts): one table of every login, and the four
-- things an administrator needs to do to one.
--
-- WHY THESE ARE DATABASE FUNCTIONS AND NOT AN ADMIN-API CALL
--
-- auth.users is not reachable from PostgREST, so the browser cannot read it at
-- all, and the obvious alternative -- putting SUPABASE_SERVICE_ROLE_KEY in a
-- Next.js server action -- means a key that bypasses every row-level security
-- policy sits in the web tier. These functions are SECURITY DEFINER instead:
-- each one re-checks public.is_admin() as its first statement, so the caller's
-- own JWT decides, exactly like the RLS policies do everywhere else.
--
-- Every function here is granted to `authenticated` ONLY. Do not grant to
-- `anon`; the database linter flags anon-executable SECURITY DEFINER functions
-- and it is right to.

-- ---------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------
-- One row per login. The counts on the right exist so the page can warn before
-- a deletion: "this account belongs to a household with 3 registrations" is the
-- difference between a safe click and a regretted one.

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
    hh.display_name,
    hh.household_count,
    coalesce(rc.n, 0),
    coalesce(pc.n, 0),
    coalesce(gc.n, 0)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.staff    s on s.profile_id = u.id
  -- A profile can sit in more than one household (rare, but allowed). Show one
  -- and report how many, rather than duplicating the person across rows.
  left join lateral (
    select
      min(m.household_id)                                    as household_id,
      count(*)::integer                                      as household_count,
      (select h.display_name
         from public.households h
        where h.id = min(m.household_id))                    as display_name
    from public.household_members m
    where m.profile_id = u.id
  ) hh on true
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

-- ---------------------------------------------------------------------------
-- 2. Remove the login (the SAFE one)
-- ---------------------------------------------------------------------------
-- Deletes the auth user. profiles_id_fkey cascades, which takes the profile,
-- their household_members row, their staff row, their MFA factors, labels and
-- trusted devices, and any event_medical_access grant.
--
-- It does NOT touch the family's records. people.profile_id and gifts.profile_id
-- are ON DELETE SET NULL, and every recorded_by / author_id / reviewed_by column
-- is too, so registrations, participants, payments, gifts, scholarships and
-- signatures all survive with their content intact -- they just stop naming the
-- person who is gone. registrations_household_id_fkey is RESTRICT and the
-- household is not being deleted here at all.
--
-- The consequence worth understanding: the household keeps existing with nobody
-- able to sign in to it, and because people.profile_id is nulled, the same
-- person signing up again gets a fresh profile that does NOT relink to their old
-- person record. Use this to clear a login; use admin_purge_household to remove
-- a test family properly.

create or replace function public.admin_delete_login(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may remove a login'
      using errcode = '42501';
  end if;

  -- Locking yourself out of the admin area is not a recoverable mistake from
  -- inside the admin area.
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove your own login'
      using errcode = '42501';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_login(uuid) from public, anon;
grant execute on function public.admin_delete_login(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Purge a household and everything under it (the DESTRUCTIVE one)
-- ---------------------------------------------------------------------------
-- For clearing test families before go-live. The delete order below is not
-- stylistic -- three foreign keys are ON DELETE RESTRICT and will refuse the
-- obvious "delete the household" one-liner:
--
--   payments.registration_id        RESTRICT  -> payments before registrations
--   coupon_redemptions.coupon_id    RESTRICT  -> redemptions before the household
--                                                cascade tries to remove coupons
--   registration_participants.person_id RESTRICT -> handled, because deleting a
--                                                registration cascades its
--                                                participants first
--
-- Gifts are deliberately NOT deleted. gifts.profile_id is SET NULL, so donation
-- records survive the purge as anonymous rows. Financial history should not
-- disappear because someone tidied up an account.

create or replace function public.admin_purge_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_member_ids uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may purge a household'
      using errcode = '42501';
  end if;

  -- Collect the logins before the household cascade removes the membership rows
  -- that point at them.
  select coalesce(array_agg(m.profile_id), '{}')
    into v_member_ids
    from public.household_members m
   where m.household_id = p_household_id;

  if auth.uid() = any (v_member_ids) then
    raise exception 'You cannot purge the household your own login belongs to'
      using errcode = '42501';
  end if;

  delete from public.payments
   where registration_id in (
     select r.id from public.registrations r where r.household_id = p_household_id
   );

  delete from public.coupon_redemptions
   where coupon_id in (
     select c.id from public.coupons c where c.household_id = p_household_id
   );

  -- Cascades participants, notes, family messages, payment plans, and through
  -- participants: scholarships, volunteer applications, activity signups,
  -- buddy assignments.
  delete from public.registrations where household_id = p_household_id;

  delete from public.people     where household_id = p_household_id;
  -- Cascades household_members, coupons, family_change_log, agreement_signatures.
  delete from public.households where id = p_household_id;

  if array_length(v_member_ids, 1) > 0 then
    delete from auth.users where id = any (v_member_ids);
  end if;
end;
$$;

revoke all on function public.admin_purge_household(uuid) from public, anon;
grant execute on function public.admin_purge_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reset someone's two-factor
-- ---------------------------------------------------------------------------
-- Same job as the admin-reset-mfa Edge Function, addressed by user id instead of
-- a typed email address, so the Accounts table can offer it on the row that is
-- already in front of you. Clears the factors themselves plus the two public
-- tables that shadow them, otherwise a stale label or a still-trusted device
-- outlives the factor it described.

create or replace function public.admin_reset_mfa(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_removed integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may reset two-factor'
      using errcode = '42501';
  end if;

  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_removed = row_count;

  delete from public.mfa_factor_labels   where profile_id = p_user_id;
  delete from public.mfa_trusted_devices where profile_id = p_user_id;

  return v_removed;
end;
$$;

revoke all on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated;
