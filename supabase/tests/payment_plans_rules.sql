-- Checks for migration 0080 (payment plans, early discount, money guard).
-- Run after supabase_stubs.sql, every migration, and payment_plans_seed.sql. Raises on failure.
\set ON_ERROR_STOP on
\pset footer off
update public.events set early_registration_ends_on='2026-12-31', early_registration_discount_cents=5000 where id='30000000-0000-0000-0000-000000000001';
\echo == 1 family cannot change a fee
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  update public.registration_participants set fee_cents=0 where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: fee change allowed';
exception when insufficient_privilege then raise notice 'PASS fee change refused';
end $$;
\echo == 2 family insert takes the option fee and zero discounts
insert into public.people (id, household_id, first_name, last_name) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','Sib','Ling');
insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status, fee_cents, discount_cents, early_discount_cents)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','sibling','submitted',0,999,999);
select fee_cents as expect_60000, discount_cents as expect_0, early_discount_cents as expect_0 from public.registration_participants where person_id='20000000-0000-0000-0000-000000000009';
rollback;
\echo == 3 candidates, pay-in-full amount, no qualification yet
select * from public.early_discount_candidates('50000000-0000-0000-0000-000000000001');
select public.pay_in_full_amount('50000000-0000-0000-0000-000000000001') as pay_in_full_expect_110000;
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents, early_discount_cents from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 4 paid in full at the discounted amount
insert into public.payments (id, registration_id, amount_cents, method, status) values ('70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',110000,'card','succeeded');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_0, early_discount_cents as expect_10000 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as still_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route as expect_paid_in_full from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 5 payment fails -> discount goes
update public.payments set status='failed' where id='70000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_120000, early_discount_cents as expect_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 6 plan activated -> discount; registrar revokes -> gone
insert into public.payment_plans (id, registration_id, schedule, status, activated_at) values ('80000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','monthly','active',now());
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_110000, early_discount_cents as expect_10000 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route as expect_plan from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
update public.payment_plans set keeps_early_discount=false where id='80000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select early_discount_cents as expect_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
update public.payment_plans set keeps_early_discount=true where id='80000000-0000-0000-0000-000000000001';
\echo == 7 late-registered person and both-weeks coexistence
update public.registration_participants set created_at='2027-01-05 10:00-05' where id='60000000-0000-0000-0000-000000000002';
update public.registration_participants set discount_cents=58000, discount_reason='Both weeks (test)' where id='60000000-0000-0000-0000-000000000001';
select * from public.early_discount_candidates('50000000-0000-0000-0000-000000000001');
select 'expect camper only, 2000 (capped at what is left)' as note;
update public.registration_participants set created_at='2026-11-01 15:00-05' where id='60000000-0000-0000-0000-000000000002';
update public.registration_participants set discount_cents=0, discount_reason=null where id='60000000-0000-0000-0000-000000000001';
\echo == 8 charge dates
select array_agg(d order by d) as monthly from public.plan_charge_dates('2026-11-01','2027-07-04','monthly') d;
select array_agg(d order by d) as semi from public.plan_charge_dates('2026-11-01','2027-01-10','semi_monthly') d;
select count(*) as expect_0 from public.plan_charge_dates('2027-07-02','2027-07-04','monthly');
\echo == 9 build installments
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
insert into public.payments (registration_id, amount_cents, method, status) values ('50000000-0000-0000-0000-000000000001',10000,'card','succeeded');
select public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01') as n;
select due_on, amount_cents from public.payment_installments where payment_plan_id='80000000-0000-0000-0000-000000000001' order by due_on;
select final_due_on from public.payment_plans where id='80000000-0000-0000-0000-000000000001';
\echo == 10 family permissions
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
select route as family_sees_own_route from public.registration_payment_routes;
select count(*) as family_sees_installments from public.payment_installments;
do $$ begin
  perform public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01');
  raise exception 'FAIL: family could build installments';
exception when insufficient_privilege then raise notice 'PASS build_plan_installments refused';
end $$;
do $$ begin
  update public.payment_plans set status='active', activated_at=now(), keeps_early_discount=true;
  if found then raise exception 'FAIL: family updated a plan'; end if;
  raise notice 'PASS family plan update touched 0 rows';
end $$;
rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
select public.pay_in_full_amount('50000000-0000-0000-0000-000000000001') as stranger_expect_null;
select count(*) as stranger_routes_expect_0 from public.registration_payment_routes;
rollback;
\echo == 11 registrar can still adjust money
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true) \g /dev/null
update public.registration_participants set discount_cents=1000 where id='60000000-0000-0000-0000-000000000001';
select 'PASS registrar discount allowed' as ok;
rollback;
\echo == 12 multi-week rule still works when called by a family
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
select public.recalc_multi_week_discount('20000000-0000-0000-0000-000000000001');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select 'PASS rule functions run from a family session' as ok;
rollback;
\echo == 13 review fixes (30 Sep): a family cannot game "registered early", options or status
insert into public.events (id, name, event_type, starts_on, ends_on, published) values ('30000000-0000-0000-0000-000000000002','Cheap Dinner','dinner','2027-02-01','2027-02-01',true) on conflict do nothing;
insert into public.event_options (id, event_id, name, fee_cents, published) values ('40000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000002','Dinner',500,true) on conflict do nothing;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  update public.registration_participants set created_at='2026-01-01' where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: backdating allowed';
exception when insufficient_privilege then raise notice 'PASS backdating refused';
end $$;
do $$ begin
  update public.registration_participants set status='cancelled' where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: family cancelled a submitted place';
exception when insufficient_privilege then raise notice 'PASS family cancel refused';
end $$;
insert into public.people (id, household_id, first_name, last_name) values ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','Other','Kid');
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000009','camper','submitted');
  raise exception 'FAIL: option from another event allowed';
exception when insufficient_privilege then raise notice 'PASS other-event option refused';
end $$;
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','camper','submitted');
  raise exception 'FAIL: camper on the free volunteer option allowed';
exception when insufficient_privilege then raise notice 'PASS volunteer option for a camper refused';
end $$;
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','volunteer','submitted');
  raise exception 'FAIL: volunteer-only place on the free option allowed';
exception when insufficient_privilege then raise notice 'PASS free option needs a paid place first';
end $$;
do $$ begin
  update public.registration_participants set camp_role='camper' where id='60000000-0000-0000-0000-000000000003';
  raise exception 'FAIL: free volunteer row turned into a camper';
exception when insufficient_privilege then raise notice 'PASS role on the free option is fixed';
end $$;
insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status, created_at)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000001','sibling','submitted','2026-01-01');
-- and the legitimate second role (0069) still works once they have a place
insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','volunteer','submitted');
select 'PASS second role allowed after a paid place' as ok;
select (created_at > now() - interval '1 minute') as created_at_forced_to_now from public.registration_participants where person_id='20000000-0000-0000-0000-000000000008';
rollback;
