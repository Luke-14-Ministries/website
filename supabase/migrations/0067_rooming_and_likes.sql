-- 0067_rooming_and_likes.sql
--
-- Ellen's E38 and E34. Neither was collected anywhere.
--
-- E38, rooming preferences. Families ask -- "she needs to be near a bathroom",
-- "these two brothers should not share" -- and there was nowhere to put the
-- answer, so it arrived by email and lived in somebody's memory until the
-- lodging screen was open.
--
-- FREE TEXT, deliberately, and only for now. The right shape is probably a
-- short list of tick-boxes with a free-text box beside it, and nobody here
-- knows what the options are: Ellen does. Guessing them would produce a list
-- families work around, and a tick-box nobody chose is harder to remove later
-- than a text box that was always temporary. Asked of Ellen 31 Aug 2026.
--
-- E34, likes and dislikes. It belongs with support needs rather than on a page
-- of its own: a leader reading "loves trains, hates loud singing" is reading it
-- for the same reason they read the behaviour notes two fields above.
--
-- Both are family-facing on the support-details form, and both are covered by
-- the same RLS as the rest of person_support.
--
-- They are NOT logged by this migration, and that is worth being exact about:
-- log_family_change() names the columns it watches in an explicit array, so a
-- new column reaches the change log only when that function is redefined.
-- 0068 does it, for these two and for allergy_severity, which 0064 missed.

alter table public.person_support
  add column if not exists rooming_preferences text,
  add column if not exists likes_dislikes      text;

comment on column public.person_support.rooming_preferences is
  'Who this person should (or should not) share a room with, and anything about the room itself -- near a bathroom, ground floor, quiet end. Free text pending a decision on sensible pre-fill options (E38, asked of Ellen 31 Aug 2026). Advisory: the lodging screen does not enforce it.';
comment on column public.person_support.likes_dislikes is
  'What this person enjoys and what they would rather avoid (E34). Sits with support needs because it is read for the same reason -- a leader planning a day, not a preference survey.';
