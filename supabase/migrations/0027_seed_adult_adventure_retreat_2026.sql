-- 0027_seed_adult_adventure_retreat_2026.sql
--
-- The ministry's second published program of 2026: a four-day adult retreat,
-- 29 Oct - 1 Nov. It exists as its own EVENT (not another Camp Celebrate week)
-- for one deliberate reason: lib/events.js splits a name on " — " to work out
-- which PROGRAM a session belongs to, and the /register chooser groups by that.
-- "Adult Adventure Retreat 2026" has no em-dash separator, so it stands alone
-- as its own program rather than appearing as a third week of camp.
--
-- Fee and deposit are the current working numbers; staff can change either from
-- the admin Setup page without a migration. Registration windows are left null
-- (= open whenever published), which is also a Setup-page decision.
--
-- Idempotent: fixed UUIDs plus on-conflict updates, so re-running is a no-op.

insert into public.events (id, name, event_type, starts_on, ends_on, deposit_cents, published)
values (
  'e7e70000-0000-4000-8000-000000000101',
  'Adult Adventure Retreat 2026',
  'retreat',
  date '2026-10-29',
  date '2026-11-01',
  5000,
  true
)
on conflict (id) do update set
  name          = excluded.name,
  event_type    = excluded.event_type,
  starts_on     = excluded.starts_on,
  ends_on       = excluded.ends_on,
  deposit_cents = excluded.deposit_cents,
  published     = excluded.published;

insert into public.event_options (id, event_id, name, fee_cents, deposit_cents, published)
values (
  'e7e70000-0000-4000-8000-000000000102',
  'e7e70000-0000-4000-8000-000000000101',
  'Adult Adventure Retreat 2026 Enrollment',
  48000,
  5000,
  true
)
on conflict (id) do update set
  event_id      = excluded.event_id,
  name          = excluded.name,
  fee_cents     = excluded.fee_cents,
  deposit_cents = excluded.deposit_cents,
  published     = excluded.published;
