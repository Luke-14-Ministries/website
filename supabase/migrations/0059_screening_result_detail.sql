-- 0059_screening_result_detail.sql
--
-- Written after seeing a REAL Checkr export (27 Aug) rather than guessing at
-- one. Two things in that file would have caused harm, and both are why the
-- importer previews before it writes.
--
-- 1. STATUS IS NOT THE RESULT. The export carries both `Status` and
--    `Assessment`. `Status` says whether the report FINISHED and reads
--    "complete" on every finished report -- including one whose verdict was
--    "consider". `Assessment` is the verdict. Treating Status as the result
--    would have marked a volunteer with a criminal-record hit as CLEARED, on a
--    safeguarding record, with nothing anywhere to show it.
--
-- 2. "Candidate email" IS NOT ALWAYS THE CANDIDATE'S. Both sample rows are for
--    a person named Steve Wayne Gillespie and both carry the email of the
--    staff member who ordered them by hand. Matching on email alone would have
--    filed someone else's background check against her record. Orders placed
--    through our own screen carry the right address (invited_email, 0057), so
--    email matching is exact for those; older hand-ordered checks fall back to
--    an exact full-name match, only where that name is unique, and the preview
--    labels which method was used so a person decides before anything lands.

alter table public.person_clearances
  add column if not exists sex_offender_result text,
  add column if not exists report_filed_on date,
  add column if not exists matched_by text;

alter table public.person_clearances
  drop constraint if exists person_clearances_matched_by_check;
alter table public.person_clearances
  add constraint person_clearances_matched_by_check
  check (matched_by is null or matched_by in ('email', 'name', 'manual'));

comment on column public.person_clearances.sex_offender_result is
  'The sex-offender registry verdict on its own, separate from the overall assessment. Recorded because it is the single thing the ministry said it cares about (26 Aug), and because an overall "consider" can be driven by a county criminal hit while the registry search came back clear -- staff need to know which. A verdict word only. It is NOT report content, and the rule in the table comment stands: no report body here, ever.';

comment on column public.person_clearances.report_filed_on is
  'The date the full report was filed in the restricted SharePoint folder. The report itself never comes here; this only answers "is the paperwork where it should be", which is the question an auditor asks.';

comment on column public.person_clearances.matched_by is
  'How an imported result was tied to this person. email = the address we submitted on the bulk order, exact and safe. name = an exact full-name match, used for checks ordered by hand before this screen existed, and confirmed by a person before it was written. manual = a staff member recorded it directly.';

-- Added later the same day, after the ministry clarified that it wants ALL
-- flags and not only sexual offences: sexual offences are priority one, but a
-- drink-driving or possession conviction is something they want the chance to
-- address, and an overall "consider" never says which search produced it.
alter table public.person_clearances
  add column if not exists screening_results jsonb;

comment on column public.person_clearances.screening_results is
  'Every screening in the report and its VERDICT WORD, as {"sex_offender_search":"clear","national_criminal_search":"consider",...}. jsonb rather than a column each because the set of screenings varies by package and Checkr adds to it. VERDICT WORDS ONLY -- what was actually found, when, and where stays in the report in the restricted SharePoint folder. The rule in the table comment stands: no report body here, ever.';

comment on column public.person_clearances.sex_offender_result is
  'The sex-offender registry verdict, kept as its own column even though it also appears in screening_results, because it is priority one for the ministry and a column can be indexed, filtered and shown in a list. A verdict word only, never report content.';
