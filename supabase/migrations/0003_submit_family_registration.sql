-- 0003_submit_family_registration.sql
--
-- One atomic, idempotent function for the family registration write, replacing the
-- sequential inserts that used to live in app/register/family/actions.js.
--
-- #8 (atomic): the whole write -- household -> membership -> people (+ support) ->
-- registration -> participants -- runs in a single transaction. A half-failed
-- submit rolls back cleanly rather than leaving a partial registration.
--
-- #7 (no duplicates on resubmit): people are matched within the household by first
-- name + last name + date of birth and updated in place; participants and support
-- rows upsert on their unique keys. Resubmitting the same family is a no-op on row
-- counts. (It does NOT remove a person the family drops on resubmit -- that belongs
-- with a future "edit registration" feature.)
--
-- SECURITY INVOKER: runs as the calling family, so row-level security still governs
-- every row. Idempotent create-or-replace, so re-running this file is safe.
--
-- Applied to luke14-prod (nnbcxqxwkivadzognpno) on 2026-08-11 and verified: a repeat
-- submit of a 3-person family left people/participant counts at 3, not 6.
--
-- Payload shape (from actions.js), roles already mapped to the camp_role enum:
--   { eventId, optionId, notes,
--     family:  { contactFirst, contactLast, email, phone, address, church },
--     members: [ { firstName, lastName, dob, role, needs, diet }, ... ] }

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
  v_first text;
  v_last text;
  v_dob date;
  v_role text;
  v_needs text;
  v_diet text;
  v_saved int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_event_id is null or v_option_id is null then raise exception 'missing event or option'; end if;

  -- Fee from the option, on the server (also verifies the option belongs to the
  -- event and is visible/published under RLS).
  select eo.fee_cents into v_fee
  from public.event_options eo
  where eo.id = v_option_id and eo.event_id = v_event_id;
  if v_fee is null then raise exception 'camp option unavailable'; end if;

  -- Household: reuse the caller's, else create it and make them the owner.
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

  -- One registration per household per event.
  insert into public.registrations (household_id, event_id, family_notes)
  values (v_household_id, v_event_id, nullif(payload->>'notes', ''))
  on conflict (household_id, event_id) do update set family_notes = excluded.family_notes
  returning id into v_registration_id;

  -- Each member: match-or-insert the person, upsert support, upsert participant.
  for v_member in select value from jsonb_array_elements(coalesce(payload->'members', '[]'::jsonb)) as x(value)
  loop
    v_first := nullif(trim(v_member->>'firstName'), '');
    v_last  := nullif(trim(v_member->>'lastName'), '');
    continue when v_first is null or v_last is null;

    v_dob  := nullif(v_member->>'dob','')::date;
    v_role := coalesce(nullif(v_member->>'role',''), 'camper');
    v_needs := nullif(trim(v_member->>'needs'), '');
    v_diet  := nullif(trim(v_member->>'diet'), '');

    select p.id into v_person_id
    from public.people p
    where p.household_id = v_household_id
      and lower(p.first_name) = lower(v_first)
      and lower(p.last_name)  = lower(v_last)
      and p.date_of_birth is not distinct from v_dob
    limit 1;

    if v_person_id is null then
      v_person_id := gen_random_uuid();
      insert into public.people (id, household_id, first_name, last_name, date_of_birth)
      values (v_person_id, v_household_id, v_first, v_last, v_dob);
    else
      update public.people set first_name = v_first, last_name = v_last, date_of_birth = v_dob
      where id = v_person_id;
    end if;

    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = excluded.disabilities, dietary_needs = excluded.dietary_needs;
    end if;

    insert into public.registration_participants
      (registration_id, person_id, event_option_id, camp_role, status, submitted_at, fee_cents, furthest_step)
    values
      (v_registration_id, v_person_id, v_option_id, v_role, 'submitted', now(), v_fee, 5)
    on conflict (registration_id, person_id, event_option_id) do update
      set camp_role = excluded.camp_role, last_activity_at = now();

    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object('ok', true, 'registrationId', v_registration_id, 'saved', v_saved);
end;
$$;

grant execute on function public.submit_family_registration(jsonb) to authenticated;
