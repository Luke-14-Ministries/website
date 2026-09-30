-- Test fixture for payment_plans_rules.sql and payment_plans_e2e.ts. SCRATCH DATABASE ONLY.
-- Test fixture: one family (Parent A + camper + a volunteer-second-role person), one registrar.
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','fam@example.org'),
 ('00000000-0000-0000-0000-00000000000b','reg@example.org');
insert into public.staff (profile_id, role) values ('00000000-0000-0000-0000-00000000000b','registrar') on conflict do nothing;
insert into public.households (id, display_name) values ('10000000-0000-0000-0000-000000000001','Test Family');
insert into public.household_members (household_id, profile_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a');
insert into public.people (id, household_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cam','Per'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Pa','Rent');
insert into public.events (id, name, event_type, starts_on, ends_on, deposit_cents, published)
 values ('30000000-0000-0000-0000-000000000001','Camp Celebrate 2027 — Week 1','camp_week','2027-07-18','2027-07-23',5000,true);
insert into public.event_options (id, event_id, name, fee_cents, published) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','General',60000,true);
insert into public.event_options (id, event_id, name, fee_cents, published, participant_role) values
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Volunteer (second role)',0,true,'volunteer');
insert into public.registrations (id, household_id, event_id, created_at) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-11-01 15:00-05');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status, fee_cents, created_at) values
 ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','camper','submitted',60000,'2026-11-01 15:00-05'),
 ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','parent_guardian','submitted',60000,'2026-11-01 15:00-05'),
 ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','volunteer','submitted',0,'2026-11-01 15:00-05');
