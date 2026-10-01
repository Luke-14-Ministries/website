-- Checks for migration 0081 (family discount, review classes, agreements,
-- deletion requests). SCRATCH DATABASE ONLY. Run after supabase_stubs.sql,
-- every migration and payment_plans_seed.sql (NOT after payment_plans_rules.sql).
\set ON_ERROR_STOP on
\pset footer off
-- The seed: Cam (camper), Pa (parent + zero-fee volunteer second role), $600 each.
-- Add two more people, joining later, so they are the 3rd and 4th.
insert into public.people (id, household_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Third','Kid'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Fourth','Kid');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status, fee_cents, created_at) values
 ('60000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','sibling','submitted',60000,'2026-11-02 10:00-05'),
 ('60000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','sibling','submitted',60000,'2026-11-03 10:00-05');
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');

do $$ declare n int; t int; begin
  select count(*) filter (where family_discount_cents = 5000), sum(family_discount_cents)
    into n, t from public.registration_participants
   where registration_id = '50000000-0000-0000-0000-000000000001';
  if n = 2 and t = 10000 then raise notice 'PASS 3rd and 4th people get $50, the zero-fee second role is not a person';
  else raise exception 'FAIL family discount: % rows, % cents', n, t; end if;
  if (select family_discount_cents from public.registration_participants where id='60000000-0000-0000-0000-000000000004') = 5000
     and (select family_discount_cents from public.registration_participants where id='60000000-0000-0000-0000-000000000001') = 0
  then raise notice 'PASS the discount goes to the later joiners';
  else raise exception 'FAIL wrong people discounted'; end if;
  if (select balance_cents from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001') = 230000
  then raise notice 'PASS balance is 4 x $600 - $100';
  else raise exception 'FAIL balance %', (select balance_cents from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001'); end if;
end $$;

-- Re-running is stable, and cancelling the 2nd person makes the 4th the 3rd.
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');
update public.registration_participants set status='cancelled' where id='60000000-0000-0000-0000-000000000002';
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');
do $$ begin
  if (select sum(family_discount_cents) from public.registration_participants where registration_id='50000000-0000-0000-0000-000000000001') = 5000
     and (select family_discount_cents from public.registration_participants where id='60000000-0000-0000-0000-000000000005') = 5000
  then raise notice 'PASS cancelling a place re-ranks the family';
  else raise exception 'FAIL re-rank'; end if;
end $$;
update public.registration_participants set status='submitted' where id='60000000-0000-0000-0000-000000000002';
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');

-- All three discounts stack, and never take a person below $0.
update public.events set early_registration_ends_on='2026-12-31', early_registration_discount_cents=5000 where id='30000000-0000-0000-0000-000000000001';
update public.registration_participants set scholarship_cents=58000 where id='60000000-0000-0000-0000-000000000005';
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');
insert into public.payments (registration_id, amount_cents, method, status, received_on)
 values ('50000000-0000-0000-0000-000000000001', 175000, 'check', 'succeeded', '2026-11-05');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select public.recalc_family_discount('50000000-0000-0000-0000-000000000001');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
do $$ declare r record; begin
  select fee_cents - discount_cents - scholarship_cents - early_discount_cents - family_discount_cents as left_over,
         early_discount_cents, family_discount_cents into r
    from public.registration_participants where id='60000000-0000-0000-0000-000000000005';
  if r.left_over >= 0 and r.early_discount_cents + r.family_discount_cents = 2000
  then raise notice 'PASS stacked discounts capped at the $20 left (early %, family %)', r.early_discount_cents, r.family_discount_cents;
  else raise exception 'FAIL cap: left %, early %, family %', r.left_over, r.early_discount_cents, r.family_discount_cents; end if;
end $$;

-- The guard: a family cannot write the family discount.
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  update public.registration_participants set family_discount_cents=60000 where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL family wrote its own family discount';
exception when insufficient_privilege then raise notice 'PASS family discount is the ministry''s to set';
end $$;
rollback;

-- Review classes.
insert into public.households (id, display_name) values
 ('10000000-0000-0000-0000-000000000002','Scholarship Family'),
 ('10000000-0000-0000-0000-000000000003','Quiet Family');
insert into public.people (id, household_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000021','10000000-0000-0000-0000-000000000002','S','One'),
 ('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000003','Q','One');
insert into public.registrations (id, household_id, event_id) values
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status, fee_cents) values
 ('60000000-0000-0000-0000-000000000021','50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000021','40000000-0000-0000-0000-000000000001','camper','submitted',60000),
 ('60000000-0000-0000-0000-000000000031','50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000031','40000000-0000-0000-0000-000000000001','volunteer','submitted',60000);
insert into public.scholarships (registration_participant_id, requested_cents, status)
 values ('60000000-0000-0000-0000-000000000021', 60000, 'requested');
insert into public.person_consents (person_id, kind, granted) values ('20000000-0000-0000-0000-000000000031','media',false);

do $$ declare a text; b text; c text; f text[]; begin
  select review_class into a from public.registration_review where registration_id='50000000-0000-0000-0000-000000000001';
  select review_class into b from public.registration_review where registration_id='50000000-0000-0000-0000-000000000002';
  select review_class, flags into c, f from public.registration_review where registration_id='50000000-0000-0000-0000-000000000003';
  if a = 'deposit_paid' and b = 'full_scholarship' and c = 'neither'
  then raise notice 'PASS three classes: %, %, %', a, b, c;
  else raise exception 'FAIL classes: %, %, %', a, b, c; end if;
  if 'media_declined' = any(f) and 'creed_not_affirmed' = any(f)
  then raise notice 'PASS flags: %', f;
  else raise exception 'FAIL flags: %', f; end if;
end $$;

-- A part scholarship is not "full".
update public.scholarships set requested_cents = 30000 where registration_participant_id='60000000-0000-0000-0000-000000000021';
do $$ begin
  if (select review_class from public.registration_review where registration_id='50000000-0000-0000-0000-000000000002') = 'neither'
  then raise notice 'PASS a part scholarship is class neither';
  else raise exception 'FAIL part scholarship'; end if;
end $$;

-- A bank transfer still clearing is not "received".
insert into public.payments (registration_id, amount_cents, method, status)
 values ('50000000-0000-0000-0000-000000000003', 5000, 'bank_transfer', 'processing');
do $$ begin
  if (select review_class from public.registration_review where registration_id='50000000-0000-0000-0000-000000000003') = 'neither'
  then raise notice 'PASS clearing money is not a received deposit';
  else raise exception 'FAIL processing counted'; end if;
end $$;

-- Agreements.
do $$ begin
  if (select count(*) from public.agreements where active and key in ('scholarship_agreement','payment_by_check')) = 0
     and (select count(*) from public.agreements where active and body like '%{{event}}%') = 4
     and (select bool_and(a.version = 2) from public.agreement_requirements r join public.agreements a on a.id = r.agreement_id)
  then raise notice 'PASS agreements: 4 event agreements at v2, requirements moved, 2 retired';
  else raise exception 'FAIL agreements'; end if;
end $$;

-- Deletion requests: a family asks for its own household only, staff handle.
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
insert into public.data_deletion_requests (household_id, requested_by, scope)
 values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','medical');
do $$ begin
  insert into public.data_deletion_requests (household_id, requested_by, scope)
   values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','medical');
  raise exception 'FAIL asked for another family';
exception when insufficient_privilege then raise notice 'PASS cannot ask for another family';
end $$;
do $$ declare n int; begin
  update public.data_deletion_requests set status='done';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS a family cannot mark its own request done';
  else raise exception 'FAIL family handled its own request'; end if;
end $$;
rollback;
