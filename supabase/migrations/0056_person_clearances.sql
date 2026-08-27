-- 0056_person_clearances.sql
--
-- Groundwork for background screening. 0029 put the Checkr columns in as a
-- placeholder and said plainly that nothing wrote them. This is the migration
-- that makes them usable -- and it widens the table's reach, because the
-- ministry's answer on 26 Aug was that screening should eventually cover every
-- adult, volunteers AND adult campers.
--
-- WHY THE TABLE IS BEING RENAMED
--
-- It was volunteer_clearances. It is keyed on person_id and always was, so it
-- has never structurally been about volunteers -- but a registrar reading the
-- name would not expect a camper in it, and a name that misleads the person
-- reading it is a defect even when the columns are right. person_clearances
-- says what it holds.
--
-- volunteer_clearances survives as a view for one deploy cycle. The migration
-- and the Vercel deploy do not land together, and seven files in app/ still
-- say the old name; without the view the admin pages break in the gap. The
-- view is a plain select, so it stays auto-updatable, and security_invoker
-- keeps the underlying RLS in force rather than bypassing it. Drop it in a
-- later migration once the app has caught up.
--
-- TWO ROUTES, DELIBERATELY DIFFERENT
--
-- 1. VOLUNTEERS -> Checkr, hosted invitation, provider = 'checkr'.
--    Checkr does not sell a sex-offender registry search on its own; it comes
--    bundled in their Basic package alongside an SSN trace, a national
--    criminal search and a global watchlist. So Basic is the floor even though
--    what the ministry cares about is sexual offences.
--
-- 2. ADULT CAMPERS -> a manual search of the public NSOPW, provider =
--    'registry_search'. This is groundwork only; the board has not decided.
--
--    The reason for the split is legal, not technical. A Checkr report is a
--    consumer report under the FCRA and needs a permissible purpose; screening
--    volunteers has one, and screening a paying participant does not obviously
--    have one. A ministry searching a free public registry itself is not
--    obtaining a consumer report at all, so that question never arises. It is
--    also free.
--
--    Neither route is proof. Checkr's own documentation notes that some states
--    do not report registrants they classify as low risk, and that registration
--    does not always follow someone across state lines.

alter table public.volunteer_clearances rename to person_clearances;

alter index if exists volunteer_clearances_checkr_candidate_idx
  rename to person_clearances_checkr_candidate_idx;
alter policy volunteer_clearances_staff on public.person_clearances
  rename to person_clearances_staff;

-- ---------------------------------------------------------------------------
-- The approval gate.
--
-- Nothing is ordered automatically. A volunteer applies, a coordinator looks
-- at the application, and a person decides to spend the money and put someone
-- through a screening. Recording WHO decided matters more here than in most
-- places: a background check is something done TO a person, and "the system
-- ordered it" is not an answer anybody should have to give.
alter table public.person_clearances
  add column if not exists ordered_by uuid references public.profiles(id),
  add column if not exists ordered_at timestamptz,
  -- Why this person is being screened. Not decoration: it is the record of
  -- which permissible purpose was being relied on, and the two routes above
  -- are not interchangeable.
  add column if not exists screening_reason text,
  -- For the manual route: what the searcher actually saw. Never report content
  -- from Checkr -- see the table comment, which is a rule.
  add column if not exists note text;

alter table public.person_clearances
  drop constraint if exists person_clearances_screening_reason_check;
alter table public.person_clearances
  add constraint person_clearances_screening_reason_check
  check (screening_reason is null
         or screening_reason in ('volunteer', 'adult_participant', 'staff'));

-- provider gains the manual registry route.
alter table public.person_clearances
  drop constraint if exists volunteer_clearances_provider_check;
alter table public.person_clearances
  drop constraint if exists person_clearances_provider_check;
alter table public.person_clearances
  add constraint person_clearances_provider_check
  check (provider in ('manual', 'checkr', 'registry_search'));

-- ---------------------------------------------------------------------------
-- Guard: never order a Checkr screening for a minor.
--
-- Checkr will not screen someone under 18, so this cannot succeed -- but the
-- reason to refuse it here is not that the API would reject it. Sending a
-- child's details to a consumer reporting agency is a serious thing to do by
-- accident, and the accident is easy: a household with a 17-year-old helper
-- who has been ticked as a volunteer.
--
-- A MISSING date of birth also refuses. That is the deliberate half: "we do
-- not know how old they are" must not read the same as "they are an adult",
-- and the fix is to fill the date in, which takes a moment.
create or replace function public.checkr_order_is_adult()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dob date;
  v_name text;
begin
  if new.provider <> 'checkr' or new.checkr_candidate_id is null then
    return new;
  end if;
  if old is not null and old.checkr_candidate_id is not distinct from new.checkr_candidate_id then
    return new;               -- already ordered; this is a status update
  end if;

  select p.date_of_birth, coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')
    into v_dob, v_name
  from public.people p where p.id = new.person_id;

  if v_dob is null then
    raise exception
      'Cannot order a background check for % without a date of birth on file. Add it first -- an unknown age must not be treated as an adult.',
      nullif(trim(v_name), '')
      using errcode = 'check_violation';
  end if;

  if v_dob > (current_date - interval '18 years') then
    raise exception
      'Cannot order a background check for % -- they are under 18. Checkr does not screen minors.',
      nullif(trim(v_name), '')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists person_clearances_adult_only on public.person_clearances;
create trigger person_clearances_adult_only
  before insert or update on public.person_clearances
  for each row
  execute function public.checkr_order_is_adult();

-- ---------------------------------------------------------------------------
-- Grants for the webhook, done NOW rather than after it silently fails.
--
-- service_role bypasses RLS but not table GRANTs. In 0054 that cost a day: the
-- refund webhook was refused at the table on every delivery while returning
-- 200, so Stripe reported success and the site showed nothing. The Checkr
-- webhook writes here for exactly the same reason and would fail exactly the
-- same way. No DELETE: a clearance record is history.
grant select, insert, update on table public.person_clearances to service_role;

-- ---------------------------------------------------------------------------
comment on table public.person_clearances is
  'One row per person recording ONLY the fact and dates of a background screening, plus opaque Checkr identifiers. This table must NEVER hold a Social Security number, a date of birth collected for screening, or any part of a report body. Those live with Checkr. The identifiers here are lookup keys, not personal data. A future self-hosted flow that collects PII into this table needs a board decision, not a pull request (0029, 0056).';

comment on column public.person_clearances.provider is
  'checkr = FCRA consumer report via the hosted invitation, used for volunteers. registry_search = a staff member searched the free public NSOPW, groundwork for adult campers, and NOT a consumer report. manual = recorded from paper, predates both.';

comment on column public.person_clearances.screening_reason is
  'Which permissible purpose this screening was run under. volunteer and staff carry an employment purpose; adult_participant does not, which is why that route uses a public registry search rather than Checkr (0056).';

comment on column public.person_clearances.ordered_by is
  'The staff member who decided to run it. A background check is done TO a person, and "the system ordered it" is not an answer anybody should have to give.';

-- Compatibility for the deploy gap. See the header; drop once app/ has caught up.
create view public.volunteer_clearances
with (security_invoker = on)
as select * from public.person_clearances;

comment on view public.volunteer_clearances is
  'TEMPORARY compatibility view for code written before 0056 renamed the table to person_clearances. Auto-updatable, security_invoker so RLS still applies. Delete once no app code references it.';
