-- 0047_camp_weeks_2027.sql
--
-- The two Camp Celebrate weeks were seeded at July 2026. That season has now
-- happened -- today is 25 August 2026 -- so every family dashboard showed both
-- camp weeks greyed as "past" while the Adult Adventure Retreat sat above them
-- as the only upcoming thing. The sort was right; the data was stale.
--
-- The season the platform is actually being built for is 2027. Adult Adventure
-- Retreat 2026 (29 Oct - 1 Nov 2026) is genuinely next and stays where it is,
-- so a family registered for all three now sees them in the order they will
-- live them:
--
--     Adult Adventure Retreat 2026   29 Oct 2026
--     Camp Celebrate 2027 - Week 1   19-23 Jul 2027
--     Camp Celebrate 2027 - Week 2   26-30 Jul 2027
--
-- Week 2 has always immediately followed Week 1 (Mon-Fri, then the next
-- Mon-Fri) and still does; 2027 lines up on the same weekdays, so this is a
-- straight shift of the same shape by 364 days rather than a new pattern.
--
-- THESE DATES ARE A MECHANICAL SHIFT, NOT A CONFIRMED BOOKING. Carson Springs
-- has to give the ministry its 2027 weeks before this goes public. If they
-- come back different, change them here (or in Setup) -- nothing downstream
-- hardcodes them.

begin;

update events
   set name       = 'Camp Celebrate 2027 — Week 1',
       starts_on  = date '2027-07-19',
       ends_on    = date '2027-07-23',
       updated_at = now()
 where id = 'e7e70000-0000-4000-8000-000000000001';

update events
   set name       = 'Camp Celebrate 2027 — Week 2',
       starts_on  = date '2027-07-26',
       ends_on    = date '2027-07-30',
       updated_at = now()
 where id = 'e7e70000-0000-4000-8000-000000000002';

-- The enrolment options carry the event name in their own label (that is what
-- the registration form prints next to the fee), so they move with it. Written
-- as a replace on the option name rather than a literal per row: if a second
-- option is ever added to a week, this still catches it.
update event_options
   set name       = replace(name, 'Camp Celebrate 2026', 'Camp Celebrate 2027'),
       updated_at = now()
 where event_id in (
         'e7e70000-0000-4000-8000-000000000001',
         'e7e70000-0000-4000-8000-000000000002'
       )
   and name like '%Camp Celebrate 2026%';

commit;
