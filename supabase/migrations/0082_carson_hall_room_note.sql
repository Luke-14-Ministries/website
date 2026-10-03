-- 0082_carson_hall_room_note.sql
--
-- Staff answers, 2 Oct 2026 (Lawrence; Staff Questions §1.3):
--   * Carson Hall's "Nurse's Room" is not a nurse's room in practice. It is the
--     old building's one room, used when someone (usually a volunteer) needs to
--     spend the night there. The name stays because Carson Springs still labels
--     it that way and staff will look for it by that name; the note says what it
--     is. Capacity stays unset until someone counts the beds.
--   * RV sites hold as many people as the RV does. CampSite capped each at 4,
--     which was arbitrary; capacity is left NULL (no cap) as 0076 already did,
--     and this migration only records why so nobody "fixes" it back to 4.
--
-- Data only; idempotent.

update public.lodgings
   set notes = 'Carson Hall''s one room. The venue still calls it the nurse''s room; in practice it is overnight overflow, usually for volunteers.'
 where name = 'Nurse''s Room' and kind = 'room';

update public.lodgings
   set notes = 'Holds as many as the RV does: no cap (CampSite''s 4 was arbitrary).'
 where kind = 'rv' and notes is null;
