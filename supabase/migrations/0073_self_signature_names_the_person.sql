-- 0073_self_signature_names_the_person.sql
--
-- A signature given for ONESELF is checked against oneself.
--
-- Found 29 September 2026 (Testing Script 3, §3.5). The Apostles' Creed
-- affirmation on the volunteer application was never being recorded: the
-- server action inserted it with no signer_name, and 0049's trigger -- which
-- exists so a family RELEASE is signed by the household's primary contact --
-- refused every row with "A signature must be signed with a name". The action
-- logged the refusal and carried on, so volunteers were asked to affirm the
-- Creed on every edit and nothing was ever on file.
--
-- The action now signs with the volunteer's own name. But 0049 would then
-- compare that name to the household's primary contact, and a volunteer who
-- is not the contact (a spouse, an adult child, a minor volunteer in a
-- family) would be refused for signing their own affirmation. Wrong rule for
-- this kind of row: an affirmation of belief is personal, and the only name
-- that can stand on it is the affirmer's.
--
-- So: signer_role = 'self' is checked against the PERSON the row is for
-- (new.person_id), everything else keeps 0049's contact rule unchanged.
-- Still 'signed_here' only; staff-recorded statuses are untouched.

create or replace function public.agreement_signature_names_contact()
returns trigger
language plpgsql
as $$
declare
  v_household_id uuid;
  v_contact text;
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

  -- A personal affirmation: the name must be the affirmer's own.
  if new.signer_role = 'self' and new.person_id is not null then
    select lower(regexp_replace(trim(p.first_name || ' ' || p.last_name), '\s+', ' ', 'g'))
      into v_contact
    from public.people p
    where p.id = new.person_id;

    if v_contact is not null and v_typed <> v_contact then
      raise exception
        'A personal affirmation must be signed with the name of the person affirming it.'
        using errcode = 'check_violation';
    end if;
    return new;
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
    raise exception
      'The signature must name the primary contact for this family. Update the primary contact first if someone else is signing.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- The trigger itself (0049) stays as it is; only the function body changed.
