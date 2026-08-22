-- 0026_enrollment_questions.sql
--
-- The columns for CampSite's three "enrollment questions" have existed since
-- the core schema (registration_participants.tshirt_size /
-- first_time_attending, households.how_did_you_hear[_from]) -- nothing ever
-- collected them. This teaches the submit RPC to carry them.
--
-- Where each question lives, and why:
--   t-shirt size, first time attending  -> PER PARTICIPANT. Both vary by
--     person and by year, so they belong on the enrolment row, not the person.
--   how did you hear about us           -> PER HOUSEHOLD, asked once. CampSite
--     asks it on every enrolment, which is why their data has the same answer
--     repeated for every child every year. It is a marketing question about a
--     family's first contact with the ministry; asking it again at the third
--     registration is noise.
--
-- Everything else about the function is unchanged from 0021; the edits are
-- additive so a resubmit keeps behaving exactly as before.

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
    insert into public.households (id, display_name, email, phone, address_line1, home_church,
                                   how_did_you_hear, how_did_you_hear_from)
    values (
      v_household_id,
      coalesce(nullif(trim(concat_ws(' ', payload#>>'{family,contactFirst}', payload#>>'{family,contactLast}')), ''), 'Family'),
      nullif(payload#>>'{family,email}', ''),
      nullif(payload#>>'{family,phone}', ''),
      nullif(payload#>>'{family,address}', ''),
      nullif(payload#>>'{family,church}', ''),
      nullif(payload#>>'{family,heardAbout}', ''),
      nullif(payload#>>'{family,heardAboutFrom}', '')
    );
    insert into public.household_members (household_id, profile_id, role)
    values (v_household_id, v_uid, 'owner');
  else
    update public.households set
      display_name  = coalesce(nullif(trim(concat_ws(' ', payload#>>'{family,contactFirst}', payload#>>'{family,contactLast}')), ''), display_name),
      email         = coalesce(nullif(payload#>>'{family,email}', ''), email),
      phone         = coalesce(nullif(payload#>>'{family,phone}', ''), phone),
      address_line1 = coalesce(nullif(payload#>>'{family,address}', ''), address_line1),
      home_church   = coalesce(nullif(payload#>>'{family,church}', ''), home_church),
      -- Never overwrite a recorded first-contact answer with a blank: the
      -- wizard only asks this of households that have not answered yet.
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

    -- The wizard still collects these two as a quick first pass; the fuller
    -- support profile is its own form (/account/details/[personId]) and must
    -- never be clobbered by a blank here -- hence the coalesce on update.
    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = coalesce(excluded.disabilities, public.person_support.disabilities),
            dietary_needs = coalesce(excluded.dietary_needs, public.person_support.dietary_needs)
      where public.person_support.disabilities is distinct from coalesce(excluded.disabilities, public.person_support.disabilities)
         or public.person_support.dietary_needs is distinct from coalesce(excluded.dietary_needs, public.person_support.dietary_needs);
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
      -- Role change on a confirmed person sends them back for staff review;
      -- the enrolment answers ride along with it.
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

  return jsonb_build_object('ok', true, 'registrationId', v_registration_id, 'saved', v_saved);
end;
$function$;
