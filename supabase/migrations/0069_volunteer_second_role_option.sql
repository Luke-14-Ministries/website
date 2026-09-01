-- 0069_volunteer_second_role_option.sql
--
-- One person, two roles at the same camp: a parent who is also volunteering.
-- Rare, real, and asked for on 31 August 2026.
--
-- NO SCHEMA CHANGE IS NEEDED, which is the point worth recording. The unique on
-- registration_participants is (registration_id, person_id, event_option_id) --
-- person_id is NOT unique on its own -- and event_options already carries a
-- nullable participant_role, with 0001 commenting that "the retreat publishes
-- two options, one per role". Two roles for one person was designed in from the
-- start and simply never used. All this migration does is publish the second
-- option so the capability can be reached.
--
-- THE FEE IS ZERO, and that is the whole accounting decision.
--
-- The ministry charges such a person ONCE, not twice. Rather than inventing a
-- discount to cancel a second fee, the second role carries no fee at all: the
-- parent row holds the real fee and the volunteer row holds nothing. So the
-- balance, the deposit (which multiplies fee-bearing heads), every statement
-- and every CSV keep working untouched, because there is no second charge
-- anywhere to reconcile. A zero is easier to audit than two numbers that must
-- always cancel.
--
-- WHY published = true. The wizard picks a week by looking for a published
-- option, so an unpublished one would be invisible to the family's own session
-- and the row could never be written under RLS (submit_family_registration is
-- SECURITY INVOKER -- it runs as the family). Published, with the *enrollment*
-- option now selected explicitly by `participant_role is null` rather than by
-- "the first published one I find", which was already fragile the moment an
-- event had two.
--
-- Named for the person reading a statement, not for the database.

insert into public.event_options
  (event_id, name, description, participant_role, fee_cents, deposit_cents,
   capacity, published, sort_order)
select
  e.id,
  'Volunteer (second role, no extra fee)',
  'For someone already registered for this event in another role who is also '
    || 'volunteering. Their fee is charged once, on their first role.',
  'volunteer',
  0,
  0,
  null,
  true,
  100
from public.events e
where not exists (
  select 1 from public.event_options o
  where o.event_id = e.id and o.participant_role = 'volunteer'
);

comment on table public.event_options is
  'What a person can be enrolled AS at an event. An event may publish more than one: the general enrollment option (participant_role null, carrying the fee) and, since 0069, a zero-fee volunteer option used when somebody already registered in another role is ALSO volunteering. Code choosing "the" option for an event must select on participant_role, never on "the first published one".';
