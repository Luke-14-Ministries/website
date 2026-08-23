-- 0028_agreements_and_consents.sql
--
-- Waivers. The machinery for these has existed since 0001 -- agreements
-- (versioned by key + version), agreement_requirements (per event, household-
-- or participant-level, with a due date), agreement_signatures (four statuses,
-- RLS that lets a family record only their OWN self_reported/signed_here and
-- lets nobody but staff UPDATE a signature) -- and it has never held a row.
-- This seeds it and wires it to the registration form.
--
-- WHAT IS AN AGREEMENT vs WHAT IS A CONSENT
--   agreements        -> things you SIGN. One typed signature covers all six,
--                        which is how the ministry has always taken them.
--                        Refusing means not attending.
--   person_consents   -> things you may freely SAY NO to, per person, without
--                        losing your place: media and directory. A refusable
--                        permission must never live in a block that gates
--                        registration, or the "consent" is not one.
--
-- The six agreement texts are CampSite's current wording, carried over
-- VERBATIM as version 1 so nothing changes legally on migration day. Known
-- weak spots in that wording (a parent purporting to release a minor's claims;
-- "the retreat" hardcoded in text also used for camp; a payment date and a
-- staff email baked into the legal body where they will rot) are written up
-- for the board and their attorney rather than quietly patched here. When the
-- board revises, insert version 2 and deactivate version 1 -- signatures point
-- at the agreement ROW, so old signatures keep proving what was actually
-- agreed to.

-- ---------------------------------------------------------------------------
-- 1. person_media_consent -> person_consents
--
-- Same table, same append-only design, now carrying a kind. The directory
-- release the ministry wants is the identical shape -- per person, refusable,
-- changeable, history preserved -- so it would be a mistake to give it its own
-- table. Zero rows exist and no application code references the old name, so
-- this is a free rename.
-- ---------------------------------------------------------------------------

alter table public.person_media_consent rename to person_consents;

alter table public.person_consents
  add column kind text not null default 'media';

alter table public.person_consents
  add constraint person_consents_kind_check
  check (kind in ('media', 'directory'));

comment on column public.person_consents.kind is
  'media    = may this person be FEATURED as a subject of published material. '
  'directory = may this person be listed in a participant directory shared '
  'with other attending families.';

comment on column public.person_consents.granted is
  'The latest row for (person_id, kind) is the current answer. A withdrawal is '
  'a NEW row, never an update -- the history of what was permitted when has to '
  'survive, because published material outlives the permission that allowed it.';

drop index if exists public.person_media_consent_person_idx;
create index person_consents_person_idx
  on public.person_consents (person_id, kind, recorded_at desc);

alter table public.person_consents
  rename constraint person_media_consent_person_id_fkey to person_consents_person_id_fkey;
alter table public.person_consents
  rename constraint person_media_consent_recorded_by_fkey to person_consents_recorded_by_fkey;

drop policy if exists person_media_consent_select on public.person_consents;
drop policy if exists person_media_consent_insert on public.person_consents;

create policy person_consents_select on public.person_consents
  for select to authenticated
  using (
    exists (
      select 1 from public.people p
      where p.id = person_consents.person_id
        and p.household_id in (select public.my_household_ids())
    )
    or public.is_staff()
  );

-- Insert only, never update: same append-only rule as before.
create policy person_consents_insert on public.person_consents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.people p
      where p.id = person_consents.person_id
        and p.household_id in (select public.my_household_ids())
    )
    or public.is_registrar()
  );


-- ---------------------------------------------------------------------------
-- 2. The six agreements, version 1, CampSite wording verbatim.
--
-- Fixed UUIDs so requirement rows and re-runs are stable. on conflict (key,
-- version) do nothing: once a version is published and someone has signed it,
-- its text must never change under them.
-- ---------------------------------------------------------------------------

insert into public.agreements (id, key, version, title, body, delivery, active) values
(
  'a9ee0000-0000-4000-8000-000000000001',
  'emergency_consent', 1,
  'Emergency Consent',
  'I acknowledge that I (as well as any family members attending) am voluntarily attending the retreat sponsored by Luke 14 Ministries. I understand that attendance involves some degree of risk. I release Luke 14 Ministries, the retreat facility, employees, volunteers, and partner organizations from any and all claims or liability arising from participation. I consent to myself (as well as any family members) receiving first aid treatment for minor injuries if necessary. In the event of an emergency, retreat leaders will make every effort to contact the emergency contact I have provided. If they cannot be reached, I give permission to the adult leader in charge to take any necessary action to secure appropriate treatment for the safety and health of myself and/or my family members.',
  'internal_document', true
),
(
  'a9ee0000-0000-4000-8000-000000000002',
  'hold_harmless', 1,
  'Hold Harmless Agreement',
  'I agree to indemnify, defend, and hold harmless Luke 14 Ministries, its officers, directors, employees, agents, volunteers, retreat facilities, and partner organizations from any and all claims or liability arising out of my participation in the program.',
  'internal_document', true
),
(
  'a9ee0000-0000-4000-8000-000000000003',
  'event_rules', 1,
  'Event Rules',
  'I understand that, in order for everyone to experience a sense of peace and relaxation, the retreat is an alcohol-free, drug-free, smoke-free, and weapon-free environment. I understand that cell service is limited and that cell phone use is discouraged, except in necessary situations.',
  'internal_document', true
),
(
  'a9ee0000-0000-4000-8000-000000000004',
  'communication_consent', 1,
  'Communication Consent',
  'I consent for retreat leaders to share relevant information from my application with other retreat leaders and volunteers in order to provide the best possible care and support for my family.',
  'internal_document', true
),
(
  'a9ee0000-0000-4000-8000-000000000005',
  'scholarship_agreement', 1,
  'Scholarship Agreement',
  'If I am receiving a scholarship, or if someone else is paying on my behalf, I agree to send the payment by October 1, 2026 and be in contact with the Luke 14 administration about payment details. ellen@luke14ministries.net',
  'internal_document', true
),
(
  'a9ee0000-0000-4000-8000-000000000006',
  'payment_by_check', 1,
  'Payment by Check',
  'I understand that I may include notes regarding my payment if needed. If I select CHECK as my payment method, I agree to mail payment to: Luke 14 Ministries, 2348 W. Andrew Johnson Hwy, #140, Morristown, TN 37814.',
  'internal_document', true
)
on conflict (key, version) do nothing;


-- ---------------------------------------------------------------------------
-- 3. Require all six on every published event, at HOUSEHOLD level.
--
-- Household rather than participant because the signer is the account holder
-- agreeing on behalf of everyone they are registering -- which is exactly what
-- CampSite's "2026 Consent Forms for The X Family" was doing, and what the
-- ministry has always collected. (See the write-up: whether a parent can
-- release a MINOR's claims this way is a question for counsel, and the answer
-- may turn this into a per-participant requirement later. The schema already
-- supports that -- applies_to takes 'participant'.)
--
-- Applied to every event that exists rather than named ones, so a new event
-- created later still needs its own requirement rows -- a deliberate choice:
-- silently attaching liability paperwork to an event nobody reviewed is worse
-- than an admin having to say "yes, these apply".
-- ---------------------------------------------------------------------------

insert into public.agreement_requirements (agreement_id, event_id, applies_to, is_required)
select a.id, e.id, 'household', true
from public.agreements a
cross join public.events e
where a.active
  and a.key in ('emergency_consent', 'hold_harmless', 'event_rules',
                'communication_consent', 'scholarship_agreement', 'payment_by_check')
  and not exists (
    select 1 from public.agreement_requirements r
    where r.agreement_id = a.id and r.event_id = e.id
  );


-- ---------------------------------------------------------------------------
-- 4. Teach the submit RPC to record the signature and the two consents.
--
-- Everything from 0026 is unchanged; this adds two blocks at the end of the
-- member loop and one after it.
-- ---------------------------------------------------------------------------

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

    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = coalesce(excluded.disabilities, public.person_support.disabilities),
            dietary_needs = coalesce(excluded.dietary_needs, public.person_support.dietary_needs)
      where public.person_support.disabilities is distinct from coalesce(excluded.disabilities, public.person_support.disabilities)
         or public.person_support.dietary_needs is distinct from coalesce(excluded.dietary_needs, public.person_support.dietary_needs);
    end if;

    -- Media and directory permissions. Append-only: a row is written ONLY when
    -- the answer differs from this person's current answer, so resubmitting an
    -- unchanged form does not fill the history with noise, and a change from
    -- yes to no is preserved as its own dated row rather than overwriting the
    -- yes that may already have allowed a photo to be published.
    if nullif(v_member->>'mediaConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'media', (v_member->>'mediaConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'mediaConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'media'
        order by c.recorded_at desc limit 1
      );
    end if;

    if nullif(v_member->>'directoryConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'directory', (v_member->>'directoryConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'directoryConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'directory'
        order by c.recorded_at desc limit 1
      );
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

  -- The signature. One typed name covers every agreement the family checked,
  -- which is how the ministry has always taken these -- but it is recorded as
  -- one row PER AGREEMENT, pointing at the specific agreement row (key +
  -- version), so years later we can show exactly which text was signed rather
  -- than "they agreed to the 2026 forms".
  --
  -- A signature is never rewritten. If a row already exists for this agreement
  -- on this registration, the family is resubmitting and the ORIGINAL stands:
  -- the date on a release is part of the evidence.
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
          and s.registration_id = v_registration_id
      );

      v_signed := v_signed + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'registrationId', v_registration_id,
    'saved', v_saved,
    'signed', v_signed
  );
end;
$function$;
