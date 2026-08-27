-- 0057_screening_batches.sql
--
-- Bulk screening without an API.
--
-- Checkr puts API access behind a $500 certification course, and it buys
-- automation and nothing else. Their dashboard's bulk upload takes a CSV of
-- three columns -- email (required), first name, phone -- and sends every
-- person the same hosted invitation the API would. The candidate types their
-- own Social Security number into Checkr's form either way, so the privacy
-- guarantee 0029 was built around survives intact without paying for it.
--
-- At twenty to forty checks a year that course cannot be recovered in saved
-- minutes, so the flow is file-based: the site works out who is due and writes
-- the CSV, a coordinator uploads it, and Checkr's results file comes back and
-- is reconciled here.
--
-- WHY invited_email EXISTS
--
-- Results come back as a CSV keyed on email address and nothing else. Matching
-- them against people.email would work right up until somebody changed their
-- address between being invited and the report landing -- and then their result
-- would match nobody, silently, on a safeguarding record.
--
-- That is not hypothetical. It happened on 26 August with a Stripe payment: a
-- family changed their contact email and the payment could no longer be tied to
-- them, which is why payments.payer_email exists (0054). Same failure, same
-- fix, applied before it costs anything this time: freeze the address actually
-- submitted, and match on that.

alter table public.person_clearances
  add column if not exists invited_email text,
  add column if not exists order_batch text;

create index if not exists person_clearances_invited_email_idx
  on public.person_clearances (lower(invited_email))
  where invited_email is not null;

create index if not exists person_clearances_order_batch_idx
  on public.person_clearances (order_batch)
  where order_batch is not null;

comment on column public.person_clearances.invited_email is
  'The email address actually SUBMITTED to Checkr on the bulk order, frozen at that moment. Results come back as a CSV keyed on email and nothing else, so this is the only reliable way to match them to a person -- people.email is live and a volunteer who changes it between ordering and result would otherwise be unmatchable. Exactly the failure that orphaned a Stripe payment on 26 Aug and produced payments.payer_email in 0054.';

comment on column public.person_clearances.order_batch is
  'Which bulk upload this row went out on, as an ISO date-time stamp. Lets a coordinator answer "did the batch I sent on Tuesday all come back", which is the question that actually gets asked -- and makes a half-imported result file obvious rather than silent.';
