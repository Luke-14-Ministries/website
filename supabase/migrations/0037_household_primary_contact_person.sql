-- 0037 — the primary contact becomes a PERSON, and the household name stops
-- impersonating one.
--
-- Reported in testing (24 Aug): changing the primary contact from Lawrence to
-- Victoria renamed the whole HOUSEHOLD to "Victoria TEST4", while My Household
-- still listed only Lawrence. Both halves of that are the same modelling
-- mistake -- the primary contact had no row of its own, so its name was being
-- stored in households.display_name, a column that means something else.
--
-- Three columns, three meanings, now kept apart:
--   households.display_name               the FAMILY name staff read on a roster
--   households.primary_contact_person_id  WHO staff call -- a real person row
--   households.email / phone              how to reach the household
--
-- Consequences that fall out for free: the contact appears in My Household
-- (which is what a family expects after naming them), can be picked as a
-- linked caregiver, and can be checked against the signature on the
-- agreements -- a name that must match a person we actually hold.

alter table public.households
  add column if not exists primary_contact_person_id uuid
    references public.people(id) on delete set null;

comment on column public.households.primary_contact_person_id is
  'The person camp staff contact about this household. A real people row, created or matched by the registration wizard from the primary-contact fields.';

comment on column public.households.display_name is
  'The FAMILY name shown to staff on rosters -- not the primary contact''s name. Set once when the household is created ("<Last> family") and only ever changed by the family on Manage Household.';

create index if not exists households_primary_contact_idx
  on public.households (primary_contact_person_id);

create or replace function public.submit_family_registration(payload jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid := (payload->>'eventId')::uuid;
  v_option_id uuid := (payload->>'optionId')::uuid;
  v_fee int;
  v_household_id uuid;
  v_registration_id uuid;
  v_member jsonb;
  v_person_id uuid;
  v_claimed_id uuid;
  v_first text;
  v_last text;
  v_dob date;
  v_sex text;
  v_role text;
  v_needs text;
  v_diet text;
  v_tshirt text;
  v_first_time boolean;
  v_existing record;
  v_saved int := 0;
  v_signer_name text;
  v_signer_role text;
  v_agreement_key text;
  v_agreement_id uuid;
  v_signed int := 0;
  v_contact_first text;
  v_contact_last text;
  v_contact_person_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_event_id is null or v_option_id is null then raise exception 'missing event or option'; end if;

  select eo.fee_cents into v_fee
  from public.event_options eo
  where eo.id = v_option_id and eo.event_id = v_event_id;
  if v_fee is null then raise exception 'camp option unavailable'; end if;

  select hm.household_id into v_household_id
  from public.household_members hm
  where hm.profile_id = v_uid
  limit 1;

  if v_household_id is null then
    v_household_id := gen_random_uuid();
    -- display_name is seeded from the family's LAST name only, and never
    -- touched again by this function. "TEST4 family", not "Victoria TEST4".
    insert into public.households (id, display_name, email, phone, address_line1,
                                   city, state, postal_code, home_church,
                                   how_did_you_hear, how_did_you_hear_from)
    values (
      v_household_id,
      coalesce(nullif(trim(payload#>>'{family,contactLast}'), '') || ' family', 'Family'),
      nullif(payload#>>'{family,email}', ''),
      nullif(payload#>>'{family,phone}', ''),
      nullif(payload#>>'{family,address}', ''),
      nullif(payload#>>'{family,city}', ''),
      upper(nullif(payload#>>'{family,state}', '')),
      nullif(payload#>>'{family,postalCode}', ''),
      nullif(payload#>>'{family,church}', ''),
      nullif(payload#>>'{family,heardAbout}', ''),
      nullif(payload#>>'{family,heardAboutFrom}', '')
    );
    insert into public.household_members (household_id, profile_id, role)
    values (v_household_id, v_uid, 'owner');
  else
    -- NOTE the absence of display_name here. Renaming a family as a
    -- side-effect of naming a contact is the bug this migration fixes.
    update public.households set
      email         = coalesce(nullif(payload#>>'{family,email}', ''), email),
      phone         = coalesce(nullif(payload#>>'{family,phone}', ''), phone),
      address_line1 = coalesce(nullif(payload#>>'{family,address}', ''), address_line1),
      city          = coalesce(nullif(payload#>>'{family,city}', ''), city),
      state         = coalesce(upper(nullif(payload#>>'{family,state}', '')), state),
      postal_code   = coalesce(nullif(payload#>>'{family,postalCode}', ''), postal_code),
      home_church   = coalesce(nullif(payload#>>'{family,church}', ''), home_church),
      how_did_you_hear      = coalesce(nullif(payload#>>'{family,heardAbout}', ''), how_did_you_hear),
      how_did_you_hear_from = coalesce(nullif(payload#>>'{family,heardAboutFrom}', ''), how_did_you_hear_from)
    where id = v_household_id;
  end if;

  insert into public.registrations (household_id, event_id, family_notes)
  values (v_household_id, v_event_id, nullif(payload->>'notes', ''))
  on conflict (household_id, event_id) do update set family_notes = excluded.family_notes
  returning id into v_registration_id;

  for v_member in select value from jsonb_array_elements(coalesce(payload->'members', '[]'::jsonb)) as x(value)
  loop
    v_first := nullif(trim(v_member->>'firstName'), '');
    v_last  := nullif(trim(v_member->>'lastName'), '');
    continue when v_first is null or v_last is null;

    v_dob  := nullif(v_member->>'dob','')::date;
    v_sex  := nullif(trim(v_member->>'sex'), '');
    v_role := coalesce(nullif(v_member->>'role',''), 'camper');
    v_needs := nullif(trim(v_member->>'needs'), '');
    v_diet  := nullif(trim(v_member->>'diet'), '');
    v_tshirt := nullif(trim(v_member->>'tshirt'), '');
    v_first_time := case
                      when v_member->>'firstTime' is null or v_member->>'firstTime' = '' then null
                      else (v_member->>'firstTime')::boolean
                    end;

    v_person_id := null;
    v_claimed_id := nullif(v_member->>'personId', '')::uuid;
    if v_claimed_id is not null then
      select p.id into v_person_id
      from public.people p
      where p.id = v_claimed_id and p.household_id = v_household_id;
    end if;

    if v_person_id is null then
      select p.id into v_person_id
      from public.people p
      where p.household_id = v_household_id
        and lower(p.first_name) = lower(v_first)
        and lower(p.last_name)  = lower(v_last)
        and p.date_of_birth is not distinct from v_dob
      limit 1;
    end if;

    -- Second chance: a person created earlier as the PRIMARY CONTACT has no
    -- date of birth, so the strict match above misses them and would create a
    -- duplicate the first time that contact also registers to attend. Match
    -- name-only against a row that has no date of birth yet, and fill it in.
    if v_person_id is null and v_dob is not null then
      select p.id into v_person_id
      from public.people p
      where p.household_id = v_household_id
        and lower(p.first_name) = lower(v_first)
        and lower(p.last_name)  = lower(v_last)
        and p.date_of_birth is null
      order by p.created_at
      limit 1;
    end if;

    if v_person_id is null then
      v_person_id := gen_random_uuid();
      insert into public.people (id, household_id, first_name, last_name, date_of_birth, gender)
      values (v_person_id, v_household_id, v_first, v_last, v_dob, v_sex);
    else
      update public.people set
        first_name = v_first,
        last_name = v_last,
        date_of_birth = v_dob,
        gender = coalesce(v_sex, gender)
      where id = v_person_id
        and (first_name is distinct from v_first
          or last_name is distinct from v_last
          or date_of_birth is distinct from v_dob
          or (v_sex is not null and gender is distinct from v_sex));
    end if;

    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = coalesce(excluded.disabilities, public.person_support.disabilities),
            dietary_needs = coalesce(excluded.dietary_needs, public.person_support.dietary_needs)
      where public.person_support.disabilities is distinct from coalesce(excluded.disabilities, public.person_support.disabilities)
         or public.person_support.dietary_needs is distinct from coalesce(excluded.dietary_needs, public.person_support.dietary_needs);
    end if;

    if nullif(v_member->>'mediaConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'media', (v_member->>'mediaConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'mediaConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'media'
        order by c.recorded_at desc limit 1);
    end if;

    if nullif(v_member->>'directoryConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'directory', (v_member->>'directoryConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'directoryConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'directory'
        order by c.recorded_at desc limit 1);
    end if;

    select rp.id, rp.camp_role, rp.status into v_existing
    from public.registration_participants rp
    where rp.registration_id = v_registration_id
      and rp.person_id = v_person_id
      and rp.event_option_id = v_option_id;

    if v_existing.id is null then
      insert into public.registration_participants
        (registration_id, person_id, event_option_id, camp_role, status, submitted_at, fee_cents, furthest_step,
         tshirt_size, first_time_attending)
      values
        (v_registration_id, v_person_id, v_option_id, v_role, 'submitted', now(), v_fee, 5,
         v_tshirt, v_first_time);
    elsif v_existing.camp_role is distinct from v_role then
      update public.registration_participants
         set camp_role = v_role,
             status = case when status = 'confirmed' then 'submitted' else status end,
             tshirt_size = coalesce(v_tshirt, tshirt_size),
             first_time_attending = coalesce(v_first_time, first_time_attending),
             last_activity_at = now()
       where id = v_existing.id;
    else
      update public.registration_participants
         set tshirt_size = coalesce(v_tshirt, tshirt_size),
             first_time_attending = coalesce(v_first_time, first_time_attending),
             last_activity_at = now()
       where id = v_existing.id
         and status in ('draft', 'submitted', 'cancelled');
    end if;

    v_saved := v_saved + 1;
  end loop;

  -- ---- the primary contact, resolved to a person -------------------------
  -- Deliberately AFTER the members loop: if the contact is also attending,
  -- their real record (with a date of birth) already exists by now and is
  -- matched, instead of a second, thinner copy being created beside it.
  v_contact_first := nullif(trim(payload#>>'{family,contactFirst}'), '');
  v_contact_last  := nullif(trim(payload#>>'{family,contactLast}'), '');

  if v_contact_first is not null and v_contact_last is not null then
    select p.id into v_contact_person_id
    from public.people p
    where p.household_id = v_household_id
      and lower(p.first_name) = lower(v_contact_first)
      and lower(p.last_name)  = lower(v_contact_last)
    order by p.created_at
    limit 1;

    -- A contact who is not attending still gets a row: they are a real member
    -- of the household, they are who staff will ring, and they are eligible to
    -- be someone's linked caregiver. No date of birth is invented for them.
    if v_contact_person_id is null then
      v_contact_person_id := gen_random_uuid();
      insert into public.people (id, household_id, first_name, last_name)
      values (v_contact_person_id, v_household_id, v_contact_first, v_contact_last);
    end if;

    update public.households
       set primary_contact_person_id = v_contact_person_id
     where id = v_household_id
       and primary_contact_person_id is distinct from v_contact_person_id;
  end if;

  v_signer_name := nullif(trim(payload#>>'{agreements,signerName}'), '');
  v_signer_role := coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'account_holder');

  if v_signer_name is not null then
    for v_agreement_key in
      select value#>>'{}' from jsonb_array_elements(coalesce(payload#>'{agreements,keys}', '[]'::jsonb))
    loop
      select a.id into v_agreement_id
      from public.agreements a
      where a.key = v_agreement_key and a.active
      order by a.version desc
      limit 1;

      continue when v_agreement_id is null;

      insert into public.agreement_signatures
        (agreement_id, household_id, registration_id, status, signer_name, signer_role)
      select v_agreement_id, v_household_id, v_registration_id, 'signed_here', v_signer_name, v_signer_role
      where not exists (
        select 1 from public.agreement_signatures s
        where s.agreement_id = v_agreement_id
          and s.household_id = v_household_id
          and s.registration_id = v_registration_id);

      v_signed := v_signed + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'registrationId', v_registration_id, 'saved', v_saved, 'signed', v_signed);
end;
$function$;

-- Backfill: where a household's display_name is exactly "<First> <Last>" of a
-- person already in it, that is the old contact-name-as-family-name bug. Point
-- primary_contact_person_id at that person. The NAME is left alone -- renaming
-- a family without asking is how this started.
update public.households h
   set primary_contact_person_id = p.id
  from public.people p
 where p.household_id = h.id
   and h.primary_contact_person_id is null
   and lower(h.display_name) = lower(trim(p.first_name || ' ' || p.last_name));
