-- 0024_admin_link_login_to_household.sql  (applied to production 21 Aug 2026)
--
-- The reverse of "remove login": attach an existing login to an existing
-- household, so a family whose old login was removed (or lost) can be
-- reconnected after a HUMAN verifies who they are. Deliberately staff-mediated
-- and admin-only -- automatic relinking by email address would hand the
-- household's records (children's details, medical notes, payment history) to
-- whoever controls that mailbox LATER, which is not necessarily the same
-- person. Recycled and compromised email addresses are exactly the case this
-- guards against.

create or replace function public.admin_link_login_to_household(
  p_user_id      uuid,
  p_household_id uuid,
  p_person_id    uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may link a login to a household'
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'That login no longer exists';
  end if;
  if not exists (select 1 from public.households h where h.id = p_household_id) then
    raise exception 'That household no longer exists';
  end if;
  if exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.profile_id = p_user_id
  ) then
    raise exception 'This login is already a member of that household';
  end if;

  -- First member back in becomes the owner; anyone after that joins as an
  -- adult. (household_members.role allows exactly these two values.)
  select case
           when exists (
             select 1 from public.household_members m
             where m.household_id = p_household_id and m.role = 'owner'
           ) then 'adult'
           else 'owner'
         end
    into v_role;

  insert into public.household_members (household_id, profile_id, role)
  values (p_household_id, p_user_id, v_role);

  -- Optionally claim a person record as "this is me". Only a person already
  -- in this household, and only one nobody else has claimed. The Accounts UI
  -- does not send this yet; the parameter exists so claiming can be added
  -- without another migration.
  if p_person_id is not null then
    update public.people
       set profile_id = p_user_id
     where id = p_person_id
       and household_id = p_household_id
       and profile_id is null;
    if not found then
      raise exception 'That person is not in this household, or is already linked to a login';
    end if;
  end if;

  return v_role;
end;
$$;

revoke all on function public.admin_link_login_to_household(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_link_login_to_household(uuid, uuid, uuid) to authenticated;
