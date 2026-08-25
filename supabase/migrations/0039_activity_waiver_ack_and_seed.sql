-- 0039 — activities become real, and the external-waiver problem gets an honest answer.
--
-- activities / activity_slots / activity_signups have existed since 0001 with
-- correct RLS and no rows. This fills them in and adds the one column the
-- schema could not have anticipated.
--
-- THE EXTERNAL WAIVER PROBLEM
-- Horseback stables and rafting outfitters run their own paperwork on their own
-- websites. The ministry cannot sign for a family, and this site cannot know
-- whether they did. So we record the ONE thing we can honestly assert: that we
-- told them, and when they said they understood. waiver_acknowledged_at is an
-- acknowledgement, NOT a signature -- the naming matters, because a column
-- called waiver_signed_at would eventually be read as proof in a conversation
-- where proof matters.
--
-- APPLIED to the production project on 24 Aug 2026.

alter table public.activity_signups
  add column if not exists waiver_acknowledged_at timestamptz;

comment on column public.activity_signups.waiver_acknowledged_at is
  'When the family confirmed they have been told this activity needs the PROVIDER''S own waiver, completed on the provider''s site. An acknowledgement that we asked -- never evidence that a waiver was signed.';

comment on column public.activities.provider_url is
  'The outside provider''s own booking or waiver page. Shown to families as a clearly outbound link; the ministry never completes it on their behalf.';

-- Seed the activities the ministry actually runs. Written with stable ids so
-- re-running is safe and staff edits are never clobbered by a redeploy.
--
-- NOTE for staff: capacities and provider names are the current working
-- numbers, meant to be corrected. Nothing here is load-bearing except the
-- booking_mode of each row, which decides how the family screen behaves.
insert into public.activities
  (id, event_id, name, description, booking_mode, capacity, fee_cents,
   provider_name, provider_url, active, sort_order)
values
  ('ac710000-0000-4000-8000-000000000001', 'e7e70000-0000-4000-8000-000000000001',
   'Horseback riding',
   'Gentle, led trail rides with side-walkers available. Riders are matched to a horse by staff on the day.',
   'signup', 12, 0, 'Local stable partner', null, true, 10),
  ('ac710000-0000-4000-8000-000000000002', 'e7e70000-0000-4000-8000-000000000001',
   'Pontoon boat outing',
   'An afternoon on the water. Life jackets provided and required for everyone aboard.',
   'signup', 20, 0, null, null, true, 20),
  ('ac710000-0000-4000-8000-000000000003', 'e7e70000-0000-4000-8000-000000000001',
   'Swimming',
   'Supervised pool time with lifeguards on duty throughout.',
   'interest', null, 0, null, null, true, 30),
  ('ac710000-0000-4000-8000-000000000004', 'e7e70000-0000-4000-8000-000000000001',
   'Arts and crafts',
   'Open studio through the week — drop in whenever it suits.',
   'interest', null, 0, null, null, true, 40),

  ('ac710000-0000-4000-8000-000000000011', 'e7e70000-0000-4000-8000-000000000002',
   'Horseback riding',
   'Gentle, led trail rides with side-walkers available. Riders are matched to a horse by staff on the day.',
   'signup', 12, 0, 'Local stable partner', null, true, 10),
  ('ac710000-0000-4000-8000-000000000012', 'e7e70000-0000-4000-8000-000000000002',
   'Pontoon boat outing',
   'An afternoon on the water. Life jackets provided and required for everyone aboard.',
   'signup', 20, 0, null, null, true, 20),
  ('ac710000-0000-4000-8000-000000000013', 'e7e70000-0000-4000-8000-000000000002',
   'Swimming',
   'Supervised pool time with lifeguards on duty throughout.',
   'interest', null, 0, null, null, true, 30),
  ('ac710000-0000-4000-8000-000000000014', 'e7e70000-0000-4000-8000-000000000002',
   'Arts and crafts',
   'Open studio through the week — drop in whenever it suits.',
   'interest', null, 0, null, null, true, 40),

  ('ac710000-0000-4000-8000-000000000101', 'e7e70000-0000-4000-8000-000000000101',
   'White water rafting',
   'A guided half-day on the river with an outside outfitter. Their own waiver must be completed on their website before the day — the ministry cannot do this for you.',
   'signup', 24, 0, 'River outfitter (to be confirmed)', null, true, 10),
  ('ac710000-0000-4000-8000-000000000102', 'e7e70000-0000-4000-8000-000000000101',
   'Hiking in the Smokies',
   'Trails chosen on the day to match the group. Sturdy shoes and a water bottle.',
   'interest', null, 0, null, null, true, 20),
  ('ac710000-0000-4000-8000-000000000103', 'e7e70000-0000-4000-8000-000000000101',
   'Zip line',
   'Height and weight limits are set by the operator; staff will confirm before the day.',
   'signup', 16, 0, 'Adventure park (to be confirmed)', null, true, 30)
on conflict (id) do nothing;
