-- 0013: tracked changes for family edits.
--
-- Families can now edit their own info (Manage Household, wizard resubmits).
-- Staff need to SEE what changed without every typo fix un-confirming a
-- camper. Database triggers record each field change (old -> new) made by a
-- signed-in NON-staff user into family_change_log; staff review and check
-- them off on /admin/changes. Staff edits and Edge-Function writes are not
-- logged -- they are staff's own actions.

create table public.family_change_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  source_table text not null,
  field text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index family_change_log_unreviewed_idx
  on public.family_change_log (changed_at desc)
  where reviewed_at is null;

alter table public.family_change_log enable row level security;

-- Staff read the log; support-detail changes stay behind the sensitive grant,
-- exactly like the data they describe.
create policy family_change_log_select on public.family_change_log
  for select using (
    is_staff() and (source_table <> 'person_support' or can_view_sensitive())
  );

-- Registrars (and admins) mark rows reviewed -- same visibility rule.
create policy family_change_log_update on public.family_change_log
  for update using (
    is_registrar() and (source_table <> 'person_support' or can_view_sensitive())
  )
  with check (
    is_registrar() and (source_table <> 'person_support' or can_view_sensitive())
  );

-- Generic UPDATE logger: diffs tracked columns via to_jsonb(old/new).
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
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','phone','email'];
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

-- Caregiver links are INSERT/DELETE rows, not field updates.
create or replace function public.log_caregiver_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row record;
  v_household uuid;
  v_name text;
begin
  if v_uid is null then return coalesce(new, old); end if;
  if exists (select 1 from public.staff s where s.profile_id = v_uid and s.active) then
    return coalesce(new, old);
  end if;

  v_row := coalesce(new, old);
  select p.household_id into v_household from public.people p where p.id = v_row.person_id;
  select trim(concat_ws(' ', p.first_name, p.last_name)) into v_name
    from public.people p where p.id = v_row.caregiver_person_id;

  insert into public.family_change_log
    (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
  values (
    v_household, v_row.person_id, v_uid, 'person_caregivers',
    'linked caregiver ' || v_row.position,
    case when tg_op = 'DELETE' then v_name end,
    case when tg_op = 'INSERT' then v_name end
  );
  return coalesce(new, old);
end;
$$;

create trigger people_family_log
  after update on public.people
  for each row execute function public.log_family_change();
create trigger households_family_log
  after update on public.households
  for each row execute function public.log_family_change();
create trigger person_support_family_log
  after update on public.person_support
  for each row execute function public.log_family_change();
create trigger registration_participants_family_log
  after update on public.registration_participants
  for each row execute function public.log_family_change();
create trigger person_caregivers_family_log
  after insert or delete on public.person_caregivers
  for each row execute function public.log_caregiver_change();
