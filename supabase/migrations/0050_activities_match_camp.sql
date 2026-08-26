-- 0050_activities_match_camp.sql
--
-- The eleven seeded activities were placeholders, written from the schema
-- rather than from camp. Testing on 25 Aug said what camp actually does, and
-- this is that -- still placeholders where a real number is unknown, but no
-- longer placeholders that contradict the ministry.
--
-- Five corrections, each from a line of the notes:
--
--   1. HORSEBACK is not capacity limited. It was seeded at 12. A cap camp does
--      not have is worse than no cap: it turns families away from something
--      that had room. (Whether it carries its own waiver is still open --
--      volunteers have historically run it, and nobody has confirmed the
--      paperwork. It stays on the staff questions list.)
--
--   2. SWIMMING and ARTS AND CRAFTS need no sign-up at all. They are open
--      through the week, first come. They stay listed, because a family
--      planning their week should see them, but they now SAY they need no
--      booking instead of implying one.
--
--   3. WHITE WATER RAFTING happens on the Wednesday of camp and was missing
--      from both camp weeks entirely -- it existed only on the retreat. Added
--      with the outside-provider flag, which is what makes the site tell
--      families the provider's own form is theirs to complete.
--
--   4. PONTOON runs on the Tuesday and needs a boarding time. Slots are a
--      build, not a data change (activity_slots has existed since 0001 and has
--      no UI); the description says so plainly rather than letting the page
--      imply a family has finished choosing when they have not.
--
--   5. ZIP LINE and HIKING come off the retreat for now, at Lawrence's word.
--      Set inactive rather than deleted: families see only active rows, staff
--      see them marked "not open", and nothing about who already asked for
--      them is destroyed.
--
-- Tone throughout follows the ethos the notes state outright: camp exists to
-- make it possible for everyone to do everything -- wheelchair users go down
-- the river and up the climbing wall. Copy here should read as an invitation
-- and a practical note, never as a list of conditions.

begin;

-- 1 ------------------------------------------------------------------------
update activities
   set capacity = null,
       updated_at = now()
 where name = 'Horseback riding';

-- 2 ------------------------------------------------------------------------
update activities
   set description = 'Open all week down at the waterfront whenever it is staffed — no sign-up needed, just come. Listed here so you can plan your week.',
       updated_at = now()
 where name = 'Swimming';

update activities
   set description = 'Running all week in the craft room — no sign-up needed, drop in whenever you like.',
       updated_at = now()
 where name = 'Arts and crafts';

-- 3 ------------------------------------------------------------------------
insert into activities (event_id, name, description, booking_mode, capacity,
                        provider_name, active, sort_order)
select e.id,
       'White water rafting',
       'Usually the Wednesday of camp. Run by an outside outfitter, so there is a form of theirs to complete as well as this — staff will send you the details. Everyone who wants to go is worth a conversation; ask even if you are unsure it will work.',
       'signup',
       null,
       'River outfitter (to be confirmed)',
       true,
       15
  from events e
 where e.id in ('e7e70000-0000-4000-8000-000000000001',
                'e7e70000-0000-4000-8000-000000000002')
   and not exists (
     select 1 from activities a
      where a.event_id = e.id and a.name = 'White water rafting');

-- 4 ------------------------------------------------------------------------
update activities
   set description = 'Usually the Tuesday of camp. Boarding times are set closer to the week — for now, putting your name down tells staff you want a place on the water.',
       updated_at = now()
 where name = 'Pontoon boat outing';

-- 5 ------------------------------------------------------------------------
update activities
   set active = false,
       updated_at = now()
 where name in ('Zip line', 'Hiking in the Smokies');

commit;
