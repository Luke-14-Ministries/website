-- 0048_scholarship_staff_note.sql
--
-- scholarships.family_statement is the family's own words: why the fee is
-- hard, what changed, what they can manage. It is the single most useful thing
-- on the record when somebody in the office picks up the phone.
--
-- setAdjustments has been overwriting it. The staff "Note (kept with the
-- scholarship record)" field wrote straight into family_statement, so the
-- moment a registrar granted an award, the family's explanation was replaced
-- by "Board-approved hardship scholarship" and was gone. Nothing warned
-- anybody, because the note that replaced it looked like a note.
--
-- One column fixes it. The two are different claims by different people and
-- should never have shared a home:
--
--   family_statement  what the FAMILY told us, written by them, never edited
--                     by staff
--   staff_note        what STAFF decided and why, written by staff
--
-- No backfill is possible -- the overwritten statements are not recoverable --
-- and none is attempted. Existing rows keep whatever family_statement holds;
-- from here the two stay apart.

alter table public.scholarships
  add column if not exists staff_note text;

comment on column public.scholarships.family_statement is
  'The family''s own words asking for help. Written by the family. Staff must never overwrite this -- staff reasoning goes in staff_note.';

comment on column public.scholarships.staff_note is
  'Staff reasoning for the grant or refusal. Written by staff, shown to staff; the family sees the outcome, not this note.';

-- status already allows requested | granted | declined | withdrawn (0001).
-- 'declined' has been legal since day one and unreachable until now: the only
-- writer set 'granted' or 'withdrawn', so a refusal could only be recorded by
-- claiming the family had taken the request back. The review actions added in
-- this batch are what finally use it. No constraint change is needed here --
-- this comment is the record of why the fourth value suddenly appears in data.
