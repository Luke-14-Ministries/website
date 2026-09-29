-- 0074_link_login_to_own_person.sql
--
-- A login is linked to the person it belongs to.
--
-- people.profile_id has existed since 0001 ("a parent has a row here AND a
-- profile, linked by profile_id") and, found 29 September 2026 (Testing
-- Script 3, §5.3), nothing has ever set it: 0 of 28 people rows carried a
-- link. Sign-up creates a profile; the family wizard creates the person; the
-- only writer was admin_link_login_to_household's optional p_person_id, which
-- the Accounts page never sends.
--
-- That went unnoticed until 31 August, when grantProgramLeader started
-- checking "is this person registered for this event" THROUGH the link -- so
-- since then no program leader can be named at all: every "Name them" is
-- refused as "not registered for this event", including for a volunteer who
-- is on that event's roster.
--
-- The rule that sets the link: the household's OWNER (household_members.role
-- = 'owner', the login that created it) is the household's PRIMARY CONTACT
-- person. That is already what the site assumes -- "I'm coming too" adds the
-- contact as the login's own row, and the contact is written from the
-- signed-in person's details. Linked once, never overwritten, and only when
-- that login is not already somebody else's row.
--
-- Backfilled for every existing household, then kept true by a trigger.

create or replace function public.link_owner_to_primary_contact(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_contact uuid;
begin
  select m.profile_id into v_owner
  from public.household_members m
  where m.household_id = p_household_id and m.role = 'owner'
  limit 1;

  select h.primary_contact_person_id into v_contact
  from public.households h
  where h.id = p_household_id;

  if v_owner is null or v_contact is null then
    return;
  end if;

  -- One row per login, one login per row.
  if exists (select 1 from public.people p where p.profile_id = v_owner) then
    return;
  end if;

  update public.people p
     set profile_id = v_owner
   where p.id = v_contact
     and p.household_id = p_household_id
     and p.profile_id is null;
end;
$$;

revoke all on function public.link_owner_to_primary_contact(uuid) from public, anon, authenticated;

comment on function public.link_owner_to_primary_contact(uuid) is
  'Sets people.profile_id on a household''s primary contact to the household owner''s login, once, when neither side is already linked. Called by triggers on households and household_members (0074).';

-- Whenever the contact is (re)set, or the owner membership arrives, link.
create or replace function public.trg_link_owner_to_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'households' then
    perform public.link_owner_to_primary_contact(new.id);
  elsif tg_table_name = 'household_members' then
    if new.role = 'owner' then
      perform public.link_owner_to_primary_contact(new.household_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_households_link_owner on public.households;
create trigger trg_households_link_owner
  after insert or update of primary_contact_person_id on public.households
  for each row
  execute function public.trg_link_owner_to_primary_contact();

drop trigger if exists trg_household_members_link_owner on public.household_members;
create trigger trg_household_members_link_owner
  after insert on public.household_members
  for each row
  execute function public.trg_link_owner_to_primary_contact();

-- Backfill: every household that already has an owner and a primary contact.
do $$
declare
  r record;
begin
  for r in select id from public.households loop
    perform public.link_owner_to_primary_contact(r.id);
  end loop;
end;
$$;
