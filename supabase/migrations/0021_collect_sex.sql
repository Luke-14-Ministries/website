-- 0021: actually collect sex.
-- people.gender existed from 0001 but nothing collected it — not the wizard,
-- not the RPC — and staff need it for volunteer pairing, adult programming,
-- and rooming assignments. Two changes:
--   1. submit_family_registration accepts a per-member "sex" value (new
--      people get it on insert; existing people update only when a non-empty
--      value is provided and differs — a family leaving it blank never wipes
--      what staff already know).
--   2. log_family_change tracks gender on people, so a family changing it
--      shows up in the Recent Changes review queue like any other edit.
-- Applied to production 17 August 2026.

create or replace function public.submit_family_registration(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
    insert into public.households (id, display_name, email, phone, address_line1, home_church)
    values (
      v_household_id,
      coalesce(nullif(trim(concat_ws(' ', payload#>>'{family,contactFirst}', payload#>>'{family,contactLast}')), ''), 'Family'),
      nullif(payload#>>'{family,email}', ''),
      nullif(payload#>>'{family,phone}', ''),
      nullif(payload#>>'{family,address}', ''),
      nullif(payload#>>'{family,church}', '')
    );
    insert into public.household_members (household_id, profile_id, role)
    values (v_household_id, v_uid, 'owner');
  else
    update public.households set
      display_name  = coalesce(nullif(trim(concat_ws(' ', payload#>>'{family,contactFirst}', payload#>>'{family,contactLast}')), ''), display_name),
      email         = coalesce(nullif(payload#>>'{family,email}', ''), email),
      phone         = coalesce(nullif(payload#>>'{family,phone}', ''), phone),
      address_line1 = coalesce(nullif(payload#>>'{family,address}', ''), address_line1),
      home_church   = coalesce(nullif(payload#>>'{family,church}', ''), home_church)
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

    -- 1) A claimed person ID wins -- but only if that person really belongs to
    --    the caller's household. A forged or stale ID falls through to the
    --    name+DOB match rather than touching anyone else's record.
    v_person_id := null;
    v_claimed_id := nullif(v_member->>'personId', '')::uuid;
    if v_claimed_id is not null then
      select p.id into v_person_id
      from public.people p
      where p.id = v_claimed_id and p.household_id = v_household_id;
    end if;

    -- 2) Fallback for new/unclaimed cards: match by name + date of birth
    --    within this household only.
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

    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = excluded.disabilities, dietary_needs = excluded.dietary_needs
      where person_support.disabilities is distinct from excluded.disabilities
         or person_support.dietary_needs is distinct from excluded.dietary_needs;
    end if;

    select rp.id, rp.camp_role, rp.status into v_existing
    from public.registration_participants rp
    where rp.registration_id = v_registration_id
      and rp.person_id = v_person_id
      and rp.event_option_id = v_option_id;

    if v_existing.id is null then
      insert into public.registration_participants
        (registration_id, person_id, event_option_id, camp_role, status, submitted_at, fee_cents, furthest_step)
      values
        (v_registration_id, v_person_id, v_option_id, v_role, 'submitted', now(), v_fee, 5);
    elsif v_existing.camp_role is distinct from v_role then
      update public.registration_participants
         set camp_role = v_role,
             status = case when status = 'confirmed' then 'submitted' else status end,
             last_activity_at = now()
       where id = v_existing.id;
    else
      update public.registration_participants
         set last_activity_at = now()
       where id = v_existing.id
         and status in ('draft', 'submitted', 'cancelled');
    end if;

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object('ok', true, 'registrationId', v_registration_id, 'saved', v_saved);
end;
$$;

-- Track family edits to gender like any other identity field.
create or replace function public.log_family_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_person uuid;
  v_tracked text[];
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  -- Only signed-in NON-staff actors (i.e., families) are logged.
  if v_uid is null then return new; end if;
  if exists (select 1 from public.staff s where s.profile_id = v_uid and s.active) then
    return new;
  end if;

  if tg_table_name = 'people' then
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','gender','phone','email'];
    v_household := new.household_id;
    v_person := new.id;
  elsif tg_table_name = 'households' then
    v_tracked := array['display_name','phone','email','address_line1','address_line2','city','state','postal_code','home_church'];
    v_household := new.id;
    v_person := null;
  elsif tg_table_name = 'person_support' then
    v_tracked := array['disabilities','medications','daily_living_supports','mobility','personal_care',
      'communication','allergy_detail','dietary_needs','rescue_medication_detail','behaviour_triggers',
      'redirection_strategies','sleep_notes','other_concerns','has_allergies','has_seizures',
      'has_rescue_medication','has_sleep_disturbance','has_caregiver','buddy_required',
      'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'];
    v_person := new.person_id;
    select p.household_id into v_household from public.people p where p.id = new.person_id;
  elsif tg_table_name = 'registration_participants' then
    v_tracked := array['camp_role'];
    v_person := new.person_id;
    select r.household_id into v_household from public.registrations r where r.id = new.registration_id;
  else
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach k in array v_tracked loop
    if (v_old ->> k) is distinct from (v_new ->> k) then
      insert into public.family_change_log
        (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
      values (v_household, v_person, v_uid, tg_table_name, k, v_old ->> k, v_new ->> k);
    end if;
  end loop;
  return new;
end;
$$;
