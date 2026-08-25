-- 0043 — placeholder cabins so the assignment screen has something to show.
--
-- Names and capacities are invented and MEANT to be corrected by staff; what
-- matters is that the shape is right: some cabins assigned whole (volunteers),
-- one lodge with rooms inside it (families), and accessibility marked
-- honestly rather than optimistically -- an unmarked cabin reads as "not
-- known to be accessible", which is the safe direction to be wrong in.
--
-- APPLIED to the production project on 24 Aug 2026.

insert into public.lodgings
  (id, event_id, parent_id, name, kind, capacity, accessible, accessible_notes, sort_order)
values
  -- Camp Celebrate Week 1 — cabins assigned whole
  ('10d90000-0000-4000-8000-000000000001', 'e7e70000-0000-4000-8000-000000000001', null,
   'Cabin 1', 'cabin', 8, true, 'Step-free entry, accessible bathroom', 10),
  ('10d90000-0000-4000-8000-000000000002', 'e7e70000-0000-4000-8000-000000000001', null,
   'Cabin 2', 'cabin', 8, true, 'Step-free entry, accessible bathroom', 20),
  ('10d90000-0000-4000-8000-000000000003', 'e7e70000-0000-4000-8000-000000000001', null,
   'Cabin 3', 'cabin', 8, false, null, 30),
  ('10d90000-0000-4000-8000-000000000004', 'e7e70000-0000-4000-8000-000000000001', null,
   'Cabin 4', 'cabin', 8, false, null, 40),
  -- ...and a lodge whose ROOMS are assigned instead of the whole building
  ('10d90000-0000-4000-8000-000000000010', 'e7e70000-0000-4000-8000-000000000001', null,
   'Main Lodge', 'lodge', null, true, 'Lift to the first floor', 50),
  ('10d90000-0000-4000-8000-000000000011', 'e7e70000-0000-4000-8000-000000000001',
   '10d90000-0000-4000-8000-000000000010',
   'Lodge Room A', 'room', 4, true, 'Ground floor, wet room', 51),
  ('10d90000-0000-4000-8000-000000000012', 'e7e70000-0000-4000-8000-000000000001',
   '10d90000-0000-4000-8000-000000000010',
   'Lodge Room B', 'room', 4, true, 'Ground floor', 52),
  ('10d90000-0000-4000-8000-000000000013', 'e7e70000-0000-4000-8000-000000000001',
   '10d90000-0000-4000-8000-000000000010',
   'Lodge Room C', 'room', 4, false, 'First floor, stairs only', 53),

  -- Camp Celebrate Week 2 — same site
  ('10d90000-0000-4000-8000-000000000101', 'e7e70000-0000-4000-8000-000000000002', null,
   'Cabin 1', 'cabin', 8, true, 'Step-free entry, accessible bathroom', 10),
  ('10d90000-0000-4000-8000-000000000102', 'e7e70000-0000-4000-8000-000000000002', null,
   'Cabin 2', 'cabin', 8, true, 'Step-free entry, accessible bathroom', 20),
  ('10d90000-0000-4000-8000-000000000103', 'e7e70000-0000-4000-8000-000000000002', null,
   'Cabin 3', 'cabin', 8, false, null, 30),
  ('10d90000-0000-4000-8000-000000000104', 'e7e70000-0000-4000-8000-000000000002', null,
   'Cabin 4', 'cabin', 8, false, null, 40),

  -- Adult Adventure Retreat — a rented lodge, rooms only
  ('10d90000-0000-4000-8000-000000000201', 'e7e70000-0000-4000-8000-000000000101', null,
   'Retreat Lodge', 'lodge', null, true, null, 10),
  ('10d90000-0000-4000-8000-000000000202', 'e7e70000-0000-4000-8000-000000000101',
   '10d90000-0000-4000-8000-000000000201',
   'Room 1', 'room', 2, true, 'Ground floor', 11),
  ('10d90000-0000-4000-8000-000000000203', 'e7e70000-0000-4000-8000-000000000101',
   '10d90000-0000-4000-8000-000000000201',
   'Room 2', 'room', 2, true, 'Ground floor', 12),
  ('10d90000-0000-4000-8000-000000000204', 'e7e70000-0000-4000-8000-000000000101',
   '10d90000-0000-4000-8000-000000000201',
   'Room 3', 'room', 2, false, 'Upstairs', 13),
  ('10d90000-0000-4000-8000-000000000205', 'e7e70000-0000-4000-8000-000000000101',
   '10d90000-0000-4000-8000-000000000201',
   'Room 4', 'room', 2, false, 'Upstairs', 14)
on conflict (id) do nothing;
