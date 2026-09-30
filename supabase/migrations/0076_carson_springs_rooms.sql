-- 0076_carson_springs_rooms.sql
--
-- The real rooms at Carson Springs ("Camp Carson"), and what a room needs to
-- say about itself.
--
-- 29 September 2026. Larry sent the venue's room list (a spreadsheet, and a
-- screenshot of the same camp in CampSite for comparison) -- the "single most
-- useful document anyone can bring" that Testing Script 3 §0 asked for. Until
-- now Rooms & Cabins showed the invented placeholders from 0043 ("Cabin 1",
-- "Main Lodge / Room A"), and nothing in the portal let staff add or change a
-- room, so the placeholders could only be corrected by a migration. This one
-- does three things:
--
--   1. Two columns a room card needs. `beds` is the venue's own description
--      ("2 Double beds", "10 bunks", "1 Double / Trundle") -- what a
--      coordinator actually thinks in. `staff_capacity` is a separate,
--      advisory count for staff/volunteers, because CampSite tracked "2 / 10
--      campers - 0 / 3 staff" per room and camp may want the same. Both are
--      optional; null means "not said".
--   2. Two more kinds: `building` (a named block whose ROOMS are assigned --
--      Lodge, Ginn, Maple, Cedar, Dogwood, Pine) and `rv` (an RV site). The
--      old `lodge` kind stays valid for the rows that carry it.
--   3. The Carson Springs inventory for both Camp Celebrate 2027 weeks, from
--      Larry's list, with the 0043 placeholders for those two events
--      DEACTIVATED (not deleted -- a test assignment may still point at one).
--      Capacity is derived from the bed description (a bunk sleeps one, a
--      double sleeps two, a trundle adds one) and is advisory as always.
--      Only Lodge 101 and 102 are marked accessible, because only they were
--      described that way; every other room is "not marked", which is the safe
--      direction to be wrong in. Rooms the list did not name (Lodge 111 and
--      207, for instance) are NOT invented -- confirm with the venue.
--
-- The Adult Adventure Retreat keeps its placeholders: a different venue,
-- no list yet.

alter table public.lodgings
  add column if not exists beds text,
  add column if not exists staff_capacity int
    check (staff_capacity is null or staff_capacity >= 0);

comment on column public.lodgings.beds is
  'The venue''s own description of the sleeping arrangement -- "2 Double beds", "10 bunks", "1 Double / Trundle". Shown on the room card; capacity is derived from it once and then advisory.';
comment on column public.lodgings.staff_capacity is
  'Advisory: how many staff or volunteers the room is meant to hold IN ADDITION to capacity. Null = not tracked separately (0076).';

alter table public.lodgings drop constraint if exists lodgings_kind_check;
alter table public.lodgings
  add constraint lodgings_kind_check
  check (kind in ('cabin', 'room', 'tent', 'lodge', 'building', 'rv', 'offsite'));

-- ---------------------------------------------------------------------------
-- The inventory, once per Camp Celebrate week.
-- ---------------------------------------------------------------------------
do $$
declare
  ev uuid;
  b uuid;
  so int;
  r record;
begin
  foreach ev in array array[
    'e7e70000-0000-4000-8000-000000000001'::uuid,   -- Week 1
    'e7e70000-0000-4000-8000-000000000002'::uuid    -- Week 2
  ] loop
    -- Retire the 0043 placeholders for this event (id prefix 10d90000-…).
    update public.lodgings
       set active = false
     where event_id = ev
       and id::text like '10d90000-0000-4000-8000-%';

    -- Skip if the real inventory is already here (re-runnable).
    if exists (select 1 from public.lodgings where event_id = ev and name = 'Lodge' and kind = 'building') then
      continue;
    end if;

    so := 0;

    -- Lodge: numbered rooms, mostly "2 Double beds"; 101 and 102 accessible.
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Lodge', 'building', so) returning id into b;
    for r in select * from (values
      (101, '1 Double bed (Accessible room)', 2, true),
      (102, '1 Double bed (Accessible room)', 2, true),
      (103, '2 Double beds', 4, false), (104, '2 Double beds', 4, false),
      (105, '2 Double beds', 4, false), (106, '2 Double beds', 4, false),
      (107, '2 Double beds', 4, false), (108, '2 Double beds', 4, false),
      (109, '2 Double beds', 4, false), (110, '2 Double beds', 4, false),
      (112, '2 Double beds', 4, false),
      (201, '2 Double beds', 4, false), (202, '2 Double beds', 4, false),
      (203, '2 Double beds', 4, false), (204, '2 Double beds', 4, false),
      (205, '2 Double beds', 4, false), (206, '2 Double beds', 4, false),
      (208, '2 Double beds', 4, false), (209, '2 Double beds', 4, false),
      (210, '2 Double beds', 4, false), (211, '2 Double beds', 4, false),
      (212, '2 Double beds', 4, false),
      (301, '2 Double beds', 4, false), (302, '2 Double beds', 4, false),
      (303, '2 Double beds', 4, false), (304, '2 Double beds', 4, false),
      (305, '2 Double beds', 4, false), (306, '2 Double beds', 4, false),
      (307, '2 Double beds', 4, false), (308, '2 Double beds', 4, false),
      (309, '2 Double beds', 4, false), (310, '2 Double beds', 4, false),
      (311, '2 Double beds', 4, false), (312, '2 Double beds', 4, false)
    ) as t(room, beds, cap, acc) loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, accessible, accessible_notes, sort_order)
      values (ev, b, 'Lodge ' || r.room, 'room', r.cap, r.beds, r.acc,
              case when r.acc then 'Accessible room (venue list)' else null end, so);
    end loop;

    -- Ginn 114–120
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Ginn', 'building', so) returning id into b;
    for r in select * from (values
      (114, '1 Double / Trundle', 3), (115, '2 bunk beds', 4), (116, '1 Double / Trundle', 3),
      (117, '2 bunk beds', 4), (118, '1 Double / Trundle', 3), (119, '2 bunk beds', 4),
      (120, '1 bunk bed', 2)
    ) as t(room, beds, cap) loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Ginn ' || r.room, 'room', r.cap, r.beds, so);
    end loop;

    -- Maple 121–128
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Maple', 'building', so) returning id into b;
    for r in select * from (values
      (121, '2 Double beds', 4), (122, '2 Double beds', 4), (123, '2 Double beds', 4),
      (124, '2 Double beds', 4), (125, '2 Double beds', 4), (126, '2 Double beds', 4),
      (127, '2 Double beds', 4), (128, '1 Double bed', 2)
    ) as t(room, beds, cap) loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Maple ' || r.room, 'room', r.cap, r.beds, so);
    end loop;

    -- Cedar 1–3
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Cedar', 'building', so) returning id into b;
    for r in select * from (values
      (1, '10 bunks', 10), (2, '10 bunks', 10), (3, '1 double bed', 2)
    ) as t(room, beds, cap) loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Cedar ' || r.room, 'room', r.cap, r.beds, so);
    end loop;

    -- Dogwood 1–7, two bunk beds each
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Dogwood', 'building', so) returning id into b;
    for r in select generate_series(1, 7) as room loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Dogwood ' || r.room, 'room', 4, '2 bunk beds', so);
    end loop;

    -- Pine 1–6 (bunk rooms)
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Pine', 'building', so) returning id into b;
    for r in select * from (values
      (1, '6 bunks', 6), (2, '8 bunks', 8), (3, '8 bunks', 8),
      (4, '8 bunks', 8), (5, '8 bunks', 8), (6, '8 bunks', 8)
    ) as t(room, beds, cap) loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Pine ' || r.room, 'room', r.cap, r.beds, so);
    end loop;

    -- Carson Hall: the nurse's room
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'Carson Hall', 'building', so) returning id into b;
    so := so + 1;
    insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, notes, sort_order)
    values (ev, b, 'Nurse''s Room', 'room', null, null, 'Capacity not given on the venue list', so);

    -- RV sites 1–11 (1–6 at 30 amp, 7–11 at 50 amp)
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, sort_order) values (ev, 'RV Sites', 'building', so) returning id into b;
    for r in select generate_series(1, 11) as site loop
      so := so + 1;
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'RV Site ' || r.site, 'rv', null,
              case when r.site <= 6 then '30 amp hookup' else '50 amp hookup' end, so);
    end loop;

    -- Off campus: people staying elsewhere, still on the list
    so := so + 10;
    insert into public.lodgings (event_id, name, kind, capacity, notes, sort_order)
    values (ev, 'Off Campus', 'offsite', null, 'Staying elsewhere; listed so nobody is missing from the count', so);
  end loop;
end;
$$;
