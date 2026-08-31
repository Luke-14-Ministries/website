-- 0065_program_leaders_comment.sql
--
-- Comment only. No schema change, and none needed -- which is the point.
--
-- 0061 left this on the table:
--
--   'A person may read the roster of ONE program at ONE event.'
--
-- That was never what the constraints say. The unique is
-- (profile_id, program_id, event_id), and program_leaders_lookup_idx is a plain
-- index rather than a unique one, so BOTH of the things that sentence appears
-- to forbid are already allowed:
--
--   * two or more people leading the SAME program at the same event -- an
--     assistant leader, asked for 31 Aug 2026, needs no build at all; naming a
--     second person to the same program already works, and the page already
--     renders leaders as a list with its own Remove beside each one.
--   * one person leading TWO programs at one event, for the leader who covers
--     both Men and Young Adults.
--
-- Left uncorrected, that sentence is the kind of documentation that gets
-- believed: somebody reads it, concludes assistants need a schema change, and
-- either builds one or tells staff it cannot be done.

comment on table public.program_leaders is
  'Grants to read one program roster at one event. A person may hold several grants: two or more leaders on the SAME program (an assistant) are allowed, and so is one person leading two programs. Not a staff role -- leaders see their own program list and nothing else. The unique is (profile_id, program_id, event_id); program_leaders_lookup_idx is a lookup index, not a constraint.';
