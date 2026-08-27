-- 0060_checkr_assessment_vocabulary.sql
--
-- Checkr's words are not our words, and the real export proved it.
--
-- checkr_status has been constrained since 0029 to eight values we chose:
-- not_started, invited, pending, clear, consider, suspended, dispute,
-- canceled. The sample export of 27 Aug carries an Assessment of "review".
-- Writing that straight through would have failed the check constraint at the
-- moment of import, with a message about a constraint rather than about a
-- background check -- after the coordinator had already read a preview saying
-- the row was fine.
--
-- Two ways out. Widening the constraint to admit every word Checkr might ever
-- use makes the column mean whatever Checkr means this year, and every screen
-- that reads it has to keep up. So instead: the constrained column stays OUR
-- vocabulary and the importer maps into it, and Checkr's own word is kept
-- verbatim, here, next to it.
--
-- That way the pill on the volunteers screen keeps working, "review" maps to
-- "consider" (both mean: a person must look at this, and nobody is cleared),
-- and if somebody later asks "but what did Checkr actually say" the answer has
-- not been thrown away.

alter table public.person_clearances
  add column if not exists assessment text;

comment on column public.person_clearances.assessment is
  'Checkr''s Assessment column, verbatim and lower-cased -- their vocabulary (clear, consider, review, escalated), not ours. checkr_status is the mapped equivalent in the site''s own eight-value vocabulary and is what screens read. Kept because a safeguarding record should not quietly translate away the source''s own word (0060).';

comment on column public.person_clearances.checkr_status is
  'The site''s own status vocabulary, constrained. The importer maps Checkr''s Assessment into it: clear stays clear; consider, review and escalated all become consider, because all three mean a person must look and nobody is cleared; an unfinished report is pending. The unmapped original is in assessment (0060).';
