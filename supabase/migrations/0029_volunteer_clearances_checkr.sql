-- 0029_volunteer_clearances_checkr.sql
--
-- PLACEHOLDER for background checks through the Checkr API. The columns are
-- real; nothing writes them yet. No API key has been issued and no webhook
-- handler exists. They are here so the shape of the finished feature -- and
-- specifically the promise below -- is visible and reviewable before anyone
-- wires it up.
--
-- THE PROMISE, which is the whole point of using the API:
--   CampSite's volunteer form asks for a Social Security number in a plain
--   required text field. That means the vendor stores it and staff can read it.
--   We will not replicate that. Checkr supports a HOSTED INVITATION flow:
--
--     1. Create a Candidate at Checkr with an EMAIL ADDRESS AND NOTHING ELSE.
--     2. Create an Invitation naming the screening package.
--     3. Checkr emails the volunteer a link.
--     4. The volunteer types their SSN and date of birth into CHECKR'S form.
--     5. A Report is created; a webhook tells us pass/fail.
--
--   Luke 14 never receives, transmits, or stores the number. It cannot leak
--   from us because we never have it, and staff cannot read it because it is
--   not here. The table comment states this as a rule, not a preference:
--   a future self-hosted flow that collects PII into this table needs a board
--   decision, not a pull request.
--
-- Cost note for whoever picks this up: the API carries no separate fee. Checkr
-- is pay-as-you-go per report with no monthly platform charge, so the
-- integration saves no money -- it removes a liability.

alter table public.volunteer_clearances
  add column provider text not null default 'manual',
  add column checkr_candidate_id text,
  add column checkr_invitation_id text,
  add column checkr_report_id text,
  add column checkr_package text,
  add column checkr_status text not null default 'not_started',
  add column adjudication text,
  add column invitation_sent_at timestamptz,
  add column report_completed_at timestamptz,
  add column last_synced_at timestamptz;

alter table public.volunteer_clearances
  add constraint volunteer_clearances_provider_check
    check (provider in ('manual', 'checkr')),
  add constraint volunteer_clearances_checkr_status_check
    check (checkr_status in ('not_started','invited','pending','clear','consider','suspended','dispute','canceled')),
  add constraint volunteer_clearances_adjudication_check
    check (adjudication is null or adjudication in ('engaged','pre_adverse_action','post_adverse_action')),
  -- A Checkr-provider row that has moved past 'not_started' must know which
  -- candidate it belongs to, or the webhook has nothing to match on.
  add constraint volunteer_clearances_checkr_needs_candidate
    check (provider <> 'checkr' or checkr_status = 'not_started' or checkr_candidate_id is not null);

create unique index volunteer_clearances_checkr_candidate_idx
  on public.volunteer_clearances (checkr_candidate_id)
  where checkr_candidate_id is not null;

comment on table public.volunteer_clearances is
  'One row per volunteer recording ONLY the fact and dates of a background check, plus opaque Checkr identifiers. This table must NEVER hold a Social Security number, a date of birth collected for screening, or any part of a report body. Those live with Checkr. The identifiers here are lookup keys, not personal data.';

comment on column public.volunteer_clearances.provider is
  'manual = paperwork handled outside the system, recorded by a registrar (the only path that works today). checkr = ordered through the Checkr API.';

comment on column public.volunteer_clearances.checkr_candidate_id is
  'Checkr candidate id. Created from an EMAIL ADDRESS ALONE via the hosted invitation flow: Checkr emails the volunteer, the volunteer types their SSN and date of birth into Checkr''s own form, and we never receive them. Do not add a self-hosted flow that collects PII here without a board decision.';

comment on column public.volunteer_clearances.checkr_status is
  'Mirrors the Checkr report status so staff can see progress without opening Checkr. Written by the webhook handler when that is built; nothing writes it today.';

comment on column public.volunteer_clearances.adjudication is
  'Set only after a "consider" result, tracking the FCRA adverse-action sequence. Deliberately separate from checkr_status: the report says what was found, adjudication says what the ministry decided to do about it.';
