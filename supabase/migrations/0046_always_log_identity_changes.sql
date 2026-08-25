-- 0046 — a change to WHO SOMEONE IS is always recorded, staff included.
--
-- log_family_change exists to show staff what FAMILIES changed, so it skips
-- edits made by staff themselves. Sensible for its purpose, and wrong for one
-- narrow case that came up on 25 Aug.
--
-- A person's first name, last name and date of birth are not ordinary fields.
-- Rosters, check-in lists and signed agreements all carry the name, and
-- submit_family_registration MATCHES RETURNING PEOPLE BY NAME + DATE OF BIRTH
-- — so changing either silently detaches someone from their own history and
-- produces a duplicate at the next registration.
--
-- Families are now blocked from editing these while a live registration
-- exists, and told to ask staff. That advice pointed at the one path with
-- neither a guard nor a record: staff could do the same thing more easily, and
-- nothing anywhere would show it had happened. This closes the record half.
-- The staff screen asks for explicit confirmation, which closes the other.
--
-- Everything else keeps the old behaviour: staff edits stay out of the log,
-- because Recent Changes is a review queue for family activity, not an audit
-- of the ministry's own staff.
--
-- APPLIED to the production project on 25 Aug 2026, and verified there:
-- a staff phone edit is still unlogged; a staff name edit now logs one row.

create or replace function public.log_family_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_person uuid;
  v_tracked text[];
  v_identity text[] := array['first_name', 'last_name', 'date_of_birth'];
  v_is_staff boolean;
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  if v_uid is null then return new; end if;

  v_is_staff := exists (
    select 1 from public.staff s where s.profile_id = v_uid and s.active
  );

  -- Staff edits are skipped as before -- EXCEPT identity fields on people,
  -- which are logged whoever makes them. See the header.
  if v_is_staff and tg_table_name <> 'people' then
    return new;
  end if;

  if tg_table_name = 'people' then
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','gender','phone','email'];
    v_household := new.household_id;
    v_person := new.id;
    -- A staff member editing a person: narrow the tracked list to identity
    -- only, so correcting a phone number does not clutter the family queue.
    if v_is_staff then
      v_tracked := v_identity;
    end if;
  elsif tg_table_name = 'households' then
    v_tracked := array['display_name','phone','email','address_line1','address_line2','city','state','postal_code','home_church','how_did_you_hear','how_did_you_hear_from'];
    v_household := new.id;
    v_person := null;
  elsif tg_table_name = 'person_support' then
    v_tracked := array['disabilities','medications','daily_living_supports','mobility','personal_care',
      'communication','allergy_detail','dietary_needs','rescue_medication_detail','seizure_detail','behaviour_triggers',
      'redirection_strategies','sleep_notes','other_concerns','has_allergies','has_seizures',
      'has_rescue_medication','has_sleep_disturbance','has_caregiver','buddy_required',
      'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'];
    v_person := new.person_id;
    select p.household_id into v_household from public.people p where p.id = new.person_id;
  elsif tg_table_name = 'registration_participants' then
    v_tracked := array['camp_role','tshirt_size','first_time_attending'];
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
$function$;
