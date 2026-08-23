-- 0031_person_support_seizure_detail.sql
--
-- Found while building the per-person support form (/account/details/[id]).
--
-- person_support had a has_seizures FLAG and nowhere to record the plan behind
-- it. The only nearby text column was rescue_medication_detail, which answers a
-- different question: "what medication, kept where" rather than "what does this
-- look like and what do I do right now". Writing the seizure plan into it would
-- put the wrong answer in front of a nurse at the moment they most need the
-- right one, so the column exists instead.
--
-- The change-log trigger is re-declared only to add the new field to the
-- person_support tracked array; the rest is identical to 0030.

alter table public.person_support add column seizure_detail text;

comment on column public.person_support.seizure_detail is
  'What a seizure looks like for this person and what staff should do. Kept separate from rescue_medication_detail on purpose: the report of what to do is not the same as the record of what is kept where.';

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
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  if v_uid is null then return new; end if;
  if exists (select 1 from public.staff s where s.profile_id = v_uid and s.active) then
    return new;
  end if;

  if tg_table_name = 'people' then
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','gender','phone','email'];
    v_household := new.household_id;
    v_person := new.id;
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
