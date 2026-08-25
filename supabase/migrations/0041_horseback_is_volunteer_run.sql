-- 0041 — horseback riding is run by volunteers, not an outside provider.
--
-- The 0039 seed guessed "Local stable partner". Lawrence corrected it on 24
-- Aug: historically the horses come from volunteers and friends of the camp,
-- and whether any waiver applies is unknown.
--
-- That correction MATTERS rather than being cosmetic, because provider_name is
-- what makes the family screen say "their own form has to be completed with
-- them" and demand an acknowledgement tick. Leaving a guessed provider in
-- place would have the site instructing families to go and complete paperwork
-- that may not exist -- asserting a fact nobody has established. Null is the
-- honest value until staff say otherwise.
--
-- OPEN QUESTION for staff (Staff Questions log): does volunteer-run horseback
-- need a waiver of its own, and if so is it the ministry's or the owner's?
--
-- APPLIED to the production project on 24 Aug 2026.

update public.activities
   set provider_name = null,
       provider_url = null
 where name = 'Horseback riding'
   and provider_name = 'Local stable partner';
