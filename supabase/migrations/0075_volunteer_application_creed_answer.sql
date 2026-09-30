-- 0075_volunteer_application_creed_answer.sql
--
-- The applicant's LATEST answer to the Creed affirmation, on the application.
--
-- 29 September 2026. The affirmation stopped being a wall on the form (the
-- board's ruling: ask everyone, let somebody who is not comfortable leave it
-- unticked and speak with Larry, flag the gap at review). That left one case
-- with no home: a volunteer who affirmed, and later re-saved the application
-- with the box UNTICKED. agreement_signatures is a record of what was signed
-- and when -- families cannot update or delete a row there, deliberately --
-- so the signature stayed and the review page went on saying "affirmed".
-- Lawrence's ruling the same evening: an untick must re-flag.
--
-- So the application carries the answer as last given, and the signature
-- stays as history. Review reads the answer; "affirmed then withdrew" is a
-- third, visible state, distinct from "never affirmed".
--
-- null = never answered on a form that had the question (older applications
-- and ones saved before this column). Backfilled to true where a signature
-- already exists, so nobody who affirmed reads as unanswered.

alter table public.volunteer_applications
  add column if not exists creed_affirmed boolean;

comment on column public.volunteer_applications.creed_affirmed is
  'The applicant''s latest answer to the Apostles'' Creed affirmation on the volunteer application: true = ticked on the last save, false = left unticked on the last save (re-flagged at review), null = not answered. agreement_signatures keeps the history of what was affirmed and when (0075).';

update public.volunteer_applications va
   set creed_affirmed = true
 where va.creed_affirmed is null
   and exists (
     select 1
     from public.registration_participants rp
     join public.agreement_signatures s on s.person_id = rp.person_id
     join public.agreements a on a.id = s.agreement_id and a.key = 'apostles_creed'
     where rp.id = va.registration_participant_id
   );
