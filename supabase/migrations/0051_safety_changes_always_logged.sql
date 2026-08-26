-- 0051_safety_changes_always_logged.sql
--
-- Testing, 25 Aug: "Edited Verity LapTEST2's description of her seizures and
-- it changed in staff view, but no trigger for activity/review."
--
-- The change log was working. The account doing the editing was STAFF, and
-- log_family_change() skips staff edits on every table except `people` -- so
-- the edit went through silently. A real family's edit would have been logged.
--
-- That is a correct diagnosis of the test and the wrong rule for the field.
-- 0046 already carved out identity fields on `people` for exactly this reason:
-- some changes matter regardless of who makes them, because the point of the
-- record is not "who is editing without permission" but "does anyone know this
-- changed". A seizure description is the clearest case in the whole schema.
-- The camp nurse's list, the buddy's briefing and the medication plan are all
-- built from it, and a staff member correcting it at 11pm is exactly the
-- circumstance in which nobody else finds out.
--
-- So: a small SAFETY set on person_support is logged whoever changes it.
-- Everything else on that table keeps the staff skip -- a registrar tidying a
-- dietary note should not fill the review queue, and a queue that fills with
-- housekeeping is a queue nobody reads.
--
-- The set is deliberately narrow: seizures, rescue medication, allergies and
-- medications. These are the fields where being out of date can hurt someone.

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
    'has_allergies','allergy_detail','medications'];
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
      'redirection_strategies','sleep_notes','other_concerns','has_allergies','has_seizures',
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
  'Field-level change log for family-editable records. Staff edits are skipped EXCEPT identity fields on people (0046) and the seizure / rescue-medication / allergy / medication fields on person_support (0051) -- those are logged whoever makes them, because the question is not who edited without permission but whether anyone knows it changed.';
