-- 0049_signature_names_the_contact.sql
--
-- A release has to name the person accountable for it.
--
-- Testing found a registration for two people -- an adult and a seven-year-old
-- -- whose six signed agreements all read "Alberto Gonzales", a name belonging
-- to nobody in the household. The form and the server action both refuse that
-- now. Neither is a boundary.
--
-- submit_family_registration is SECURITY INVOKER (correct -- RLS applies to
-- everything it writes) and EXECUTE is granted to `authenticated`. So any
-- signed-in person can POST to it directly with a payload of their choosing,
-- and the signer-name rule, living only in JavaScript, would not be there.
-- The same is true of the scholarship agreement, which is inserted straight
-- into agreement_signatures by a server action.
--
-- This trigger is where the rule actually lives. It applies to signatures
-- TYPED ON THIS SITE ('signed_here') and to nothing else:
--
--   self_reported / paper_on_file / confirmed_external are staff recording a
--   signature that happened elsewhere -- a form brought to camp, a release
--   posted in. Who may sign one of those is a policy question for the board
--   (it is on the staff questions list), and until they answer it, staff
--   judgment governs. A database trigger must not pre-empt that answer.
--
-- It also only fires where there is something to check against: a household
-- with no primary contact recorded yet cannot contradict anybody.

create or replace function public.agreement_signature_names_contact()
returns trigger
language plpgsql
as $$
declare
  v_household_id uuid;
  v_contact text;
  -- Case, and runs of whitespace, are not disagreements about identity.
  v_typed   text;
begin
  if new.status is distinct from 'signed_here' then
    return new;
  end if;

  v_typed := lower(regexp_replace(trim(coalesce(new.signer_name, '')), '\s+', ' ', 'g'));
  if v_typed = '' then
    raise exception 'A signature must be signed with a name.'
      using errcode = 'check_violation';
  end if;

  v_household_id := new.household_id;
  if v_household_id is null and new.person_id is not null then
    select p.household_id into v_household_id from public.people p where p.id = new.person_id;
  end if;
  if v_household_id is null then
    return new;
  end if;

  select lower(regexp_replace(trim(c.first_name || ' ' || c.last_name), '\s+', ' ', 'g'))
    into v_contact
  from public.households h
  join public.people c on c.id = h.primary_contact_person_id
  where h.id = v_household_id;

  if v_contact is null then
    return new;
  end if;

  if v_typed <> v_contact then
    -- Worded for the person who will read it. The fix is theirs and it is on
    -- the same page: correct the primary contact, or sign as the contact.
    raise exception
      'The signature must name the primary contact for this family. Update the primary contact first if someone else is signing.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_agreement_signature_names_contact on public.agreement_signatures;

create trigger trg_agreement_signature_names_contact
  before insert on public.agreement_signatures
  for each row
  execute function public.agreement_signature_names_contact();

comment on function public.agreement_signature_names_contact() is
  'Refuses a typed ("signed_here") signature whose name is not the household''s primary contact. Staff-recorded paper and external signatures are deliberately exempt -- who may sign those is an open board question.';
