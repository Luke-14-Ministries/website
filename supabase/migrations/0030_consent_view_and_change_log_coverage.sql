-- 0030_consent_view_and_change_log_coverage.sql
--
-- Closes the gap found auditing the staff portal on 23 Aug: everything
-- registration started collecting on 22-23 Aug was WRITE-ONLY. No admin
-- surface read a t-shirt size, an enrolment answer, a signature or a
-- permission, and nothing a family changed afterwards was logged for review.
-- The application half of that fix is in the /admin pages; this is the two
-- pieces that belong in the database.
--
-- 1. A view for "the current answer", because person_consents is append-only
--    and every consumer was otherwise re-deriving the newest row by hand.
-- 2. Change-log coverage, so a family editing one of the new fields -- or
--    withdrawing a permission -- is not silent.

-- ---------------------------------------------------------------------------
-- 1. person_current_consents
--
-- security_invoker = on is the important word here. Without it the view would
-- run as ITS OWNER and quietly bypass row-level security, handing every
-- family's answers to any authenticated caller. With it, the caller's own
-- policies apply exactly as they do to the underlying table: a family sees
-- their household, staff see everyone.
-- ---------------------------------------------------------------------------

create or replace view public.person_current_consents
with (security_invoker = on) as
select distinct on (c.person_id, c.kind)
  c.person_id,
  c.kind,
  c.granted,
  c.recorded_at,
  c.recorded_as
from public.person_consents c
order by c.person_id, c.kind, c.recorded_at desc;

comment on view public.person_current_consents is
  'The CURRENT answer per person per consent kind. person_consents is append-only, so "what is true now" is the newest row -- every consumer was otherwise re-deriving that by hand. security_invoker = on so the caller''s row-level security applies exactly as it does to the underlying table.';

grant select on public.person_current_consents to authenticated;


-- ---------------------------------------------------------------------------
-- 2a. Change-log coverage for the new registration fields.
--
-- Only the tracked arrays change; the rest of the function is byte-identical
-- to the version in 0013. registration_participants tracked ONLY camp_role,
-- so a family changing a t-shirt size was invisible. households gains the two
-- heard-about columns for the same reason.
-- ---------------------------------------------------------------------------

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
  -- Staff edits are not "family changes"; they do not need review.
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
      'communication','allergy_detail','dietary_needs','rescue_medication_detail','behaviour_triggers',
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


-- ---------------------------------------------------------------------------
-- 2b. Permission CHANGES reach the review queue.
--
-- person_consents is insert-only, so the generic old/new comparison in
-- log_family_change does not apply -- "the previous answer" is a different
-- row, not a different column. Hence its own trigger.
--
-- Only CHANGES are logged. A first-ever answer arrives with the registration
-- itself, which registrars already see on the roster and the detail page;
-- logging it too would bury the one entry that matters under one per person
-- per season. A change is different: a family withdrawing photo permission
-- after a week of camp has been photographed is exactly the thing nobody
-- should have to notice by accident.
-- ---------------------------------------------------------------------------

create or replace function public.log_consent_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_prev boolean;
begin
  if v_uid is null then return new; end if;
  if exists (select 1 from public.staff s where s.profile_id = v_uid and s.active) then
    return new;
  end if;

  select c.granted into v_prev
  from public.person_consents c
  where c.person_id = new.person_id
    and c.kind = new.kind
    and c.id <> new.id
  order by c.recorded_at desc
  limit 1;

  -- No previous answer = a first answer, not a change. Same answer again =
  -- nothing happened.
  if v_prev is null or v_prev is not distinct from new.granted then
    return new;
  end if;

  select p.household_id into v_household from public.people p where p.id = new.person_id;

  insert into public.family_change_log
    (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
  values (v_household, new.person_id, v_uid, 'person_consents', new.kind,
          case when v_prev then 'true' else 'false' end,
          case when new.granted then 'true' else 'false' end);

  return new;
end;
$function$;

comment on function public.log_consent_change() is
  'Surfaces a CHANGED media or directory permission in the staff review queue. A first-ever answer is not logged: it arrives with the registration itself, which registrars already see. person_consents remains the audit trail; this is the review queue.';

create trigger person_consents_family_log
  after insert on public.person_consents
  for each row execute function public.log_consent_change();
