-- 0002_seed_camp_celebrate_2026.sql
--
-- Seed catalogue data for the first real registration flow: Camp Celebrate 2026.
-- Additive only. 0001 is never edited (it has been run); this adds rows, no DDL.
--
-- Shape follows DATA-MODEL.md: Camp Celebrate publishes ONE enrollment option per
-- week with participant_role NULL ("this enrollment is for both Volunteers and
-- Camper Families"); the role comes from each person's own pre-enrollment answer,
-- not from the option.
--
-- Pricing: $495 per person for now (per-camper model). Adjustable later from an
-- admin screen. Each participant's fee is snapshotted at registration, so changing
-- these values will not disturb families who have already registered.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, so re-running is safe.
--
-- Applied to luke14-prod (nnbcxqxwkivadzognpno) on 2026-08-11 via execute_sql,
-- matching how 0001 was applied (manual run; migrations table intentionally empty).
--
-- TODO before Stripe (Phase 2): confirm the real deposit amount (deposit_cents is 0
-- here) and whether volunteers/siblings/caregivers pay a different fee (all $495 for
-- now). Both are data-only changes.

-- Week 1 is capped at 230 (per DATA-MODEL.md); Week 2 is unlimited (capacity NULL).
insert into public.events
  (id, name, event_type, description, starts_on, ends_on, deposit_cents, capacity, published)
values
  ('e7e70000-0000-4000-8000-000000000001', 'Camp Celebrate 2026 — Week 1', 'camp_week',
   'A week of Camp Celebrate for campers with disabilities, their families, and volunteers.',
   '2026-07-20', '2026-07-24', 0, 230, true),
  ('e7e70000-0000-4000-8000-000000000002', 'Camp Celebrate 2026 — Week 2', 'camp_week',
   'A week of Camp Celebrate for campers with disabilities, their families, and volunteers.',
   '2026-07-27', '2026-07-31', 0, null, true)
on conflict (id) do nothing;

-- One published enrollment option per week. participant_role NULL = role taken from
-- the person's own answer. fee_cents = $495. deposit_cents NULL defers to the event.
insert into public.event_options
  (id, event_id, name, participant_role, fee_cents, deposit_cents, capacity, published, sort_order)
values
  ('0b710000-0000-4000-8000-000000000001', 'e7e70000-0000-4000-8000-000000000001',
   'Camp Celebrate 2026 — Week 1 Enrollment', null, 49500, null, null, true, 1),
  ('0b710000-0000-4000-8000-000000000002', 'e7e70000-0000-4000-8000-000000000002',
   'Camp Celebrate 2026 — Week 2 Enrollment', null, 49500, null, null, true, 2)
on conflict (id) do nothing;

-- Rollback (if ever needed):
--   delete from public.event_options where id in
--     ('0b710000-0000-4000-8000-000000000001','0b710000-0000-4000-8000-000000000002');
--   delete from public.events where id in
--     ('e7e70000-0000-4000-8000-000000000001','e7e70000-0000-4000-8000-000000000002');
