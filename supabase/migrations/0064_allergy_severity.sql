-- 0064_allergy_severity.sql
--
-- Ellen's E33 and E42: we record WHETHER there are allergies and a free-text
-- description, and nothing about how bad they are. "Mild lactose intolerance"
-- and "anaphylactic to peanuts" arrive on the kitchen list looking identical,
-- and the kitchen list is printed deliberately WITHOUT names (0028 era) so
-- there is nobody to ask.
--
-- THREE LEVELS, AND WHY NOT TWO
--
-- The brief was: three only if the levels are actionably distinct, otherwise
-- just mild and severe. They are distinct, because each one changes what a
-- person standing in a kitchen or a cabin actually does:
--
--   mild         Avoid where it is easy. Discomfort, not danger. A different
--                pudding, not a different plan.
--   severe       Must be avoided properly, and a reaction means finding the
--                camp nurse. Cross-contamination matters.
--   anaphylaxis  Life-threatening. There is rescue medication, somebody has
--                to know where it is, and a reaction means adrenaline and an
--                ambulance rather than a nurse.
--
-- The line between the second and third is the one worth encoding: it is the
-- difference between "fetch help" and "act now, then fetch help". Collapsing
-- them into "severe" would hide exactly the case the field exists for.
--
-- Nullable, and no default. A null means nobody has said, which is different
-- from "mild" and must not be shown as if somebody had answered. Existing rows
-- with has_allergies = true therefore read as "severity not recorded", which is
-- honest -- we did not ask them.
--
-- Deliberately NOT derived from allergy_detail or has_rescue_medication. A
-- guess about how dangerous somebody's allergy is, made by string-matching a
-- free-text box, is the kind of clever that gets a child hurt.

alter table public.person_support
  add column if not exists allergy_severity text
    check (allergy_severity is null
           or allergy_severity in ('mild', 'severe', 'anaphylaxis'));

comment on column public.person_support.allergy_severity is
  'How bad the allergy is, in the only terms that change what somebody does: mild (avoid where easy), severe (must avoid; a reaction means the nurse), anaphylaxis (life-threatening; rescue medication and an ambulance). NULL means not recorded -- never treat it as mild. Only meaningful when has_allergies is true.';
