-- 0068_log_new_support_columns.sql
--
-- Three columns were added to person_support and none of them reached the
-- change log, because log_family_change() names the columns it watches in an
-- explicit array rather than reading them from the table.
--
--   allergy_severity     added 0064, and MISSED. That is the bad one: the
--                        free-text allergy_detail beside it has always been
--                        logged, so "peanuts" changing was recorded while
--                        "mild" becoming "anaphylaxis" was not.
--   rooming_preferences  added 0067
--   likes_dislikes       added 0067
--
-- allergy_severity also joins v_safety, the short list logged even when STAFF
-- make the edit. It belongs there for the same reason has_allergies and
-- allergy_detail do: the question that list answers is not "did somebody edit
-- without permission" but "does anyone know this changed".
--
-- The pattern to notice, since it has now been missed once: adding a column to
-- person_support is not finished until this function is redefined. 0031 did it
-- for seizure_detail; 0064 did not do it for allergy_severity.
--
-- Generated from the 0051 definition with only the two arrays changed, rather
-- than retyped -- the function is a hundred lines and transcription is how a
-- log quietly starts missing a different field.

create or replace function public.log_family_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_person uuid;
  v_tracked text[];
  v_identity text[] := array['first_name', 'last_name', 'date_of_birth'];
  -- Logged no matter who edits them. See the header.
  v_safety text[] := array['has_seizures','seizure_detail',
    'has_rescue_medication','rescue_medication_detail',
    'has_allergies','allergy_detail','allergy_severity','medications'];
  v_is_staff boolean;
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  if v_uid is null then return new; end if;

  v_is_staff := exists (
    select 1 from public.staff s where s.profile_id = v_uid and s.active
  );

  -- Staff edits are skipped -- EXCEPT identity fields on people (0046) and the
  -- safety fields on person_support (this migration).
  if v_is_staff and tg_table_name not in ('people', 'person_support') then
    return new;
  end if;

  if tg_table_name = 'people' then
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','gender','phone','email'];
    v_household := new.household_id;
    v_person := new.id;
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
      'redirection_strategies','sleep_notes','other_concerns','has_allergies','allergy_severity','has_seizures',
      'rooming_preferences','likes_dislikes',
      'has_rescue_medication','has_sleep_disturbance','has_caregiver','buddy_required',
      'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'];
    v_person := new.person_id;
    select p.household_id into v_household from public.people p where p.id = new.person_id;
    -- A staff member editing support details: narrow to the safety set, so
    -- correcting a dietary note stays out of the queue but changing a seizure
    -- description never does.
    if v_is_staff then
      v_tracked := v_safety;
    end if;
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
$$;

comment on function public.log_family_change() is
  'Field-level change log for family-editable records. Staff edits are skipped EXCEPT identity fields on people (0046) and the seizure / rescue-medication / allergy (including severity) / medication fields on person_support (0051, 0068) -- those are logged whoever makes them, because the question is not who edited without permission but whether anyone knows it changed.';
