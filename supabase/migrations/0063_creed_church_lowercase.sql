-- 0063_creed_church_lowercase.sql
--
-- "the holy catholic Church" becomes "the holy catholic church" (31 Aug 2026,
-- asked for on sight of the rendered form).
--
-- The capital C came in verbatim from the text supplied on 30 August, which
-- capitalises Church while leaving catholic lower-case. Both words mean the
-- same thing here -- the universal Christian church rather than a denomination
-- -- and the ministry wants that read plainly, so both are lower-case now.
--
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0062
--
-- 0062 has been run. The rule in CLAUDE.md is that a migration which has been
-- applied is never edited, because the repository stops describing the
-- database the moment it is. Editing 0062 would have been quicker and would
-- have left production and the repository agreeing today, and disagreeing with
-- every rebuild from scratch afterwards.
--
-- WHY THIS UPDATES VERSION 1 RATHER THAN CREATING VERSION 2
--
-- Because nobody has signed it yet -- checked, and enforced below rather than
-- trusted. The immutability rule from 0028 protects people who have already
-- affirmed a wording; with no signatures there is nobody to protect, and a
-- version 2 whose only difference from an unsigned version 1 is one capital
-- letter would be noise in a table meant to record real changes.
--
-- Had a single signature existed, this would have had to be version 2, and the
-- guard below would have stopped it. That is the point of the guard: the rule
-- is worth more as something the database enforces than as a paragraph
-- somebody has to remember to read.

do $$
declare
  v_signed int;
begin
  select count(*) into v_signed
  from public.agreement_signatures s
  join public.agreements a on a.id = s.agreement_id
  where a.key = 'apostles_creed' and a.version = 1;

  if v_signed > 0 then
    raise exception
      'apostles_creed v1 has % signature(s); its text is frozen. Publish a version 2 instead.',
      v_signed;
  end if;

  update public.agreements
     set body = replace(body, 'the holy catholic Church,', 'the holy catholic church,')
   where key = 'apostles_creed'
     and version = 1;
end $$;
