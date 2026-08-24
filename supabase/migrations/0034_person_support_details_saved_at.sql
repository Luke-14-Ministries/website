-- 0034_person_support_details_saved_at.sql
--
-- Found on the first morning of human testing (24 Aug): the dashboard marked
-- BOTH of a family's people "Details on file" when only one support form had
-- been filled in. The status was inferred from content -- "any of the fields
-- staff most need is non-empty" -- and the registration wizard was writing to
-- one of those same columns (disabilities, via its "short version" box). So
-- anyone who typed anything at registration looked done without ever seeing
-- the form the status was about.
--
-- The fix is to stop inferring. This stamp is set by the details form's save
-- action and by nothing else, and the dashboard reads it and nothing else.
-- A status should be a fact, not a guess.

alter table public.person_support add column details_saved_at timestamptz;

comment on column public.person_support.details_saved_at is
  'Set ONLY by the family-facing details form (/account/details/[personId]) each time it saves. The dashboard''s "Details on file / Not started" status reads this and nothing else. It exists because inferring completion from content proved wrong on day one of testing (24 Aug 2026): the registration wizard also wrote to disabilities, so anyone who typed anything at registration looked "done" without ever seeing the form.';
