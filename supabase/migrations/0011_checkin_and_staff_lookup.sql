-- 0011: day-of check-in + staff lookup for the Staff & Access page.

-- Who has actually arrived at camp, and who marked them in.
alter table public.registration_participants
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references public.profiles (id) on delete set null;

-- Check-in is door duty: registrars, coordinators and admins. A dedicated RPC
-- (SECURITY DEFINER) updates ONLY the check-in fields, so coordinators get
-- door duty without gaining the registrar's broader edit rights over statuses
-- and fees.
create or replace function public.set_check_in(p_participant_id uuid, p_checked_in boolean)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_result timestamptz;
begin
  if not exists (
    select 1 from public.staff s
    where s.profile_id = v_uid and s.active
      and s.role in ('registrar', 'coordinator', 'admin')
  ) then
    raise exception 'not permitted';
  end if;

  update public.registration_participants
     set checked_in_at = case when p_checked_in then now() else null end,
         checked_in_by = case when p_checked_in then v_uid else null end
   where id = p_participant_id
   returning checked_in_at into v_result;
  return v_result;
end;
$$;
grant execute on function public.set_check_in(uuid, boolean) to authenticated;

-- Admins add staff by email, but emails live in auth.users, which clients
-- cannot read. This narrow lookup returns just enough to add a staff row, and
-- only for admins (non-admins get zero rows).
create or replace function public.staff_lookup_by_email(p_email text)
returns table (profile_id uuid, first_name text, last_name text)
language sql security definer set search_path = '' as $$
  select p.id, p.first_name, p.last_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and exists (
      select 1 from public.staff s
      where s.profile_id = (select auth.uid()) and s.active and s.role = 'admin'
    );
$$;
grant execute on function public.staff_lookup_by_email(text) to authenticated;
