-- =====================================================================
-- Luke 14 Ministries — row-level security test harness
--
-- Not part of the migration. Run against a scratch database to prove
-- the policies do what the comments claim. Every check either passes
-- silently or raises.
--
-- Personas:
--   familyA      — an ordinary account holder
--   familyB      — a different family, used to prove isolation
--   registrar    — staff, registrations and money, NO sensitive access
--   coordinator  — staff, buddies and activities, NO sensitive access
--   familyCoord  — staff WITH the standing sensitive grant
--   doctor       — camp doctor, event-scoped medical access only
--   (anon)       — not logged in
-- =====================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.as_user(u uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
end;
$$;

-- expect(label, actual, expected)
create or replace function pg_temp.expect(lbl text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — got %, expected %', lbl, actual, expected;
  end if;
end;
$$;

-- expect_denied(label, sql) — the statement must fail
create or replace function pg_temp.expect_denied(lbl text, stmt text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;   -- denial is the pass
  end;
  raise exception 'FAIL: % — statement was ALLOWED and should not have been', lbl;
end;
$$;

-- expect_allowed(label, sql)
create or replace function pg_temp.expect_allowed(lbl text, stmt text)
returns void language plpgsql as $$
begin
  execute stmt;
exception when others then
  raise exception 'FAIL: % — statement was DENIED: %', lbl, sqlerrm;
end;
$$;

-- expect_no_effect(label, sql)
--
-- A row hidden by a USING clause is not an error — the statement runs
-- and touches nothing. That is a different failure mode from a WITH
-- CHECK denial, which raises. Both are real protections and both need
-- testing, but only one of them throws.
create or replace function pg_temp.expect_no_effect(lbl text, stmt text)
returns void language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: % — statement affected % row(s), expected 0', lbl, n;
  end if;
exception
  when raise_exception then raise;
  when others then return;   -- an outright denial is also a pass
end;
$$;


-- ---------------------------------------------------------------------
-- Seed, as the table owner (bypasses RLS)
-- ---------------------------------------------------------------------

do $$
declare
  uA uuid := 'aaaa0000-0000-4000-8000-000000000001';
  uB uuid := 'bbbb0000-0000-4000-8000-000000000002';
  uR uuid := 'cccc0000-0000-4000-8000-000000000003';
  uC uuid := 'dddd0000-0000-4000-8000-000000000004';
  uF uuid := 'eeee0000-0000-4000-8000-000000000005';
  uD uuid := 'ffff0000-0000-4000-8000-000000000006';
  hA uuid; hB uuid;
  pA uuid; pB uuid; pVol uuid;
  ev uuid; optCamper uuid; optVol uuid;
  regA uuid; regB uuid;
  rpA uuid; rpB uuid; rpVol uuid;
  act uuid; agr uuid;
begin
  insert into auth.users (id, email) values
    (uA,'a@example.test'), (uB,'b@example.test'), (uR,'r@example.test'),
    (uC,'c@example.test'), (uF,'f@example.test'), (uD,'d@example.test');
  -- profiles are created by the trigger

  insert into public.staff (profile_id, role, can_view_sensitive) values
    (uR, 'registrar',   false),
    (uC, 'coordinator', false),
    (uF, 'registrar',   true);

  insert into public.households (id, display_name) values
    (gen_random_uuid(), 'Family A') returning id into hA;
  insert into public.households (id, display_name) values
    (gen_random_uuid(), 'Family B') returning id into hB;

  insert into public.household_members (household_id, profile_id, role)
    values (hA, uA, 'owner'), (hB, uB, 'owner');

  insert into public.people (household_id, first_name, last_name)
    values (hA, 'Alex', 'AAA') returning id into pA;
  insert into public.people (household_id, first_name, last_name)
    values (hB, 'Bella', 'BBB') returning id into pB;
  insert into public.people (household_id, first_name, last_name)
    values (hA, 'Vic', 'AAA') returning id into pVol;

  insert into public.person_support (person_id, disabilities, has_seizures)
    values (pA, 'sample text', true);
  insert into public.person_support (person_id, disabilities)
    values (pB, 'other family');

  insert into public.events (id, name, event_type, starts_on, ends_on, published)
    values (gen_random_uuid(), 'Test Week', 'camp_week',
            current_date, current_date + 4, true) returning id into ev;

  insert into public.event_options (event_id, name, participant_role, fee_cents, published)
    values (ev, 'Camper', 'camper', 49500, true) returning id into optCamper;
  insert into public.event_options (event_id, name, participant_role, fee_cents, published)
    values (ev, 'Volunteer', 'volunteer', 0, true) returning id into optVol;

  insert into public.registrations (household_id, event_id) values (hA, ev) returning id into regA;
  insert into public.registrations (household_id, event_id) values (hB, ev) returning id into regB;

  insert into public.registration_participants (registration_id, person_id, event_option_id, fee_cents)
    values (regA, pA, optCamper, 49500) returning id into rpA;
  insert into public.registration_participants (registration_id, person_id, event_option_id, fee_cents)
    values (regB, pB, optCamper, 49500) returning id into rpB;
  insert into public.registration_participants (registration_id, person_id, event_option_id, fee_cents)
    values (regA, pVol, optVol, 0) returning id into rpVol;

  insert into public.registration_notes (registration_id, body)
    values (regA, 'staff only comment');

  insert into public.activities (id, event_id, name, booking_mode, provider_url)
    values (gen_random_uuid(), ev, 'Rafting', 'signup', 'https://example.test/group')
    returning id into act;

  insert into public.agreements (id, key, version, title, delivery, external_url)
    values (gen_random_uuid(), 'rafting_waiver', 1, 'Rafting waiver',
            'external_link', 'https://example.test/waiver')
    returning id into agr;

  insert into public.coupons (code, percent_off, max_redemptions)
    values ('SECRET25', 25, 1);

  insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id)
    values (ev, rpVol, rpA);

  insert into public.message_log (to_email, template_key) values ('a@example.test', 'welcome');

  -- camp doctor: in-date grant for this event only
  insert into public.event_medical_access (profile_id, event_id, starts_on, ends_on)
    values (uD, ev, current_date - 1, current_date + 7);

  -- stash ids for the checks below
  create temp table t (k text primary key, v uuid);
  insert into t values
    ('uA',uA),('uB',uB),('uR',uR),('uC',uC),('uF',uF),('uD',uD),
    ('hA',hA),('hB',hB),('pA',pA),('pB',pB),
    ('ev',ev),('regA',regA),('rpA',rpA),('rpB',rpB),('rpVol',rpVol),
    ('act',act),('agr',agr);
end;
$$;


-- ---------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------

do $$
declare
  uA uuid; uB uuid; uR uuid; uC uuid; uF uuid; uD uuid;
  hA uuid; pA uuid; pB uuid; ev uuid; regA uuid;
  rpA uuid; rpB uuid; agr uuid;
  n bigint;
begin
  select v into uA from t where k='uA';   select v into uB from t where k='uB';
  select v into uR from t where k='uR';   select v into uC from t where k='uC';
  select v into uF from t where k='uF';   select v into uD from t where k='uD';
  select v into hA from t where k='hA';   select v into pA from t where k='pA';
  select v into pB from t where k='pB';   select v into ev from t where k='ev';
  select v into regA from t where k='regA';
  select v into rpA from t where k='rpA'; select v into rpB from t where k='rpB';
  select v into agr from t where k='agr';

  set local role authenticated;

  ---- family isolation -------------------------------------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.households;
  perform pg_temp.expect('A sees only own household', n, 1);
  select count(*) into n from public.people;
  perform pg_temp.expect('A sees only own people', n, 2);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('A sees only own support records', n, 1);
  select count(*) into n from public.registrations;
  perform pg_temp.expect('A sees only own registration', n, 1);
  select count(*) into n from public.registration_participants;
  perform pg_temp.expect('A sees only own participants', n, 2);
  select count(*) into n from public.registration_balances;
  perform pg_temp.expect('balances view respects RLS', n, 1);

  perform pg_temp.as_user(uB);
  select count(*) into n from public.people where id = pA;
  perform pg_temp.expect('B cannot see A''s person', n, 0);
  select count(*) into n from public.person_support where person_id = pA;
  perform pg_temp.expect('B cannot see A''s support record', n, 0);

  ---- staff-only tables are invisible to families ----------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.registration_notes;
  perform pg_temp.expect('family cannot read staff notes', n, 0);
  select count(*) into n from public.coupons;
  perform pg_temp.expect('family cannot read coupons', n, 0);
  select count(*) into n from public.message_log;
  perform pg_temp.expect('family cannot read message log', n, 0);
  select count(*) into n from public.volunteer_clearances;
  perform pg_temp.expect('family cannot read clearances', n, 0);

  ---- the sensitive tier ----------------------------------------------
  perform pg_temp.as_user(uR);
  select count(*) into n from public.people;
  perform pg_temp.expect('registrar sees all people', n, 3);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('registrar WITHOUT sensitive grant sees no support records', n, 0);

  perform pg_temp.as_user(uC);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('coordinator sees no support records', n, 0);

  perform pg_temp.as_user(uF);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('sensitive-grant staff sees all support records', n, 2);

  ---- the camp doctor --------------------------------------------------
  perform pg_temp.as_user(uD);
  select count(*) into n from public.person_support where person_id = pA;
  perform pg_temp.expect('doctor sees support for a camper at their event', n, 1);
  select count(*) into n from public.person_support where person_id = pB;
  perform pg_temp.expect('doctor also sees B (also at this event)', n, 1);

  ---- family write limits ----------------------------------------------
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_allowed('family may submit own participant',
    format('update public.registration_participants set status=''submitted'' where id=%L', rpA));
  perform pg_temp.expect_denied('family may NOT confirm own participant',
    format('update public.registration_participants set status=''confirmed'' where id=%L', rpA));
  perform pg_temp.expect_no_effect('family may NOT touch another family''s participant',
    format('update public.registration_participants set status=''cancelled'' where id=%L', rpB));
  perform pg_temp.expect_denied('family may NOT record a payment',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 1000, ''check'')', regA));
  perform pg_temp.expect_denied('family may NOT write a staff note',
    format('insert into public.registration_notes (registration_id, body) values (%L, ''sneaky'')', regA));
  perform pg_temp.expect_denied('family may NOT assert external confirmation',
    format('insert into public.agreement_signatures (agreement_id, person_id, status) values (%L, %L, ''confirmed_external'')', agr, pA));
  perform pg_temp.expect_allowed('family MAY self-report a waiver',
    format('insert into public.agreement_signatures (agreement_id, person_id, status) values (%L, %L, ''self_reported'')', agr, pA));

  ---- staff write limits -----------------------------------------------
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_allowed('registrar may record a cheque',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''check'')', regA));
  perform pg_temp.expect_denied('registrar may NOT hand-write a card payment',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''card'')', regA));
  perform pg_temp.expect_denied('registrar may NOT move buddies',
    format('insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id) values (%L, %L, %L)', ev, rpB, rpA));

  perform pg_temp.as_user(uC);
  perform pg_temp.expect_allowed('coordinator MAY move buddies',
    format('insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id) values (%L, %L, %L)', ev, rpB, rpA));

  ---- buddy visibility -------------------------------------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('family sees no buddies before publication', n, 0);

  set local role postgres;
  update public.events set buddy_assignments_published_at = now() where id = ev;
  set local role authenticated;

  perform pg_temp.as_user(uA);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('family sees own buddies after publication', n, 2);
  perform pg_temp.as_user(uB);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('B sees only assignments involving B', n, 1);

  ---- anonymous visitors ----------------------------------------------
  -- anon has SELECT granted on the catalogue tables so a public "our
  -- camps" page can render. Everything else must be invisible.
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into n from public.events;
  perform pg_temp.expect('anon sees the published event', n, 1);
  select count(*) into n from public.event_options;
  perform pg_temp.expect('anon sees published options', n, 2);
  select count(*) into n from public.activities;
  perform pg_temp.expect('anon sees active activities', n, 1);

  perform pg_temp.expect_denied('anon cannot read people',
    'select count(*) from public.people');
  perform pg_temp.expect_denied('anon cannot read households',
    'select count(*) from public.households');
  perform pg_temp.expect_denied('anon cannot read support records',
    'select count(*) from public.person_support');
  perform pg_temp.expect_denied('anon cannot read registrations',
    'select count(*) from public.registrations');
  perform pg_temp.expect_denied('anon cannot read coupons',
    'select count(*) from public.coupons');

  set local role postgres;
  update public.events set published = false where id = ev;
  set local role anon;
  select count(*) into n from public.events;
  perform pg_temp.expect('anon sees nothing once the event is unpublished', n, 0);

  set local role authenticated;
  raise notice 'ALL CHECKS PASSED';
end;
$$;
