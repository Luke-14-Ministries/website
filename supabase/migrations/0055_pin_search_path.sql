-- 0055_pin_search_path.sql
--
-- Supabase's security advisor, 26 Aug: two functions have a mutable
-- search_path. Everything else in the schema pins it; these two were missed --
-- set_updated_at from 0001, and agreement_signature_names_contact from 0049,
-- which is mine and four days old.
--
-- WHY THIS ONE MATTERS AND THE OTHER SIXTY WARNINGS DO NOT
--
-- A SECURITY DEFINER function runs with its owner's rights. If it does not pin
-- search_path, it resolves unqualified names using the CALLER's search_path --
-- so a caller who can create a schema can put their own `people` table ahead
-- of ours and have a function running as the owner read it instead. That is a
-- real escalation shape, and pinning the path closes it outright.
--
-- The advisor's other 60 notices are a different thing: Postgres grants
-- EXECUTE on every new function to PUBLIC, so `grant execute ... to
-- authenticated` never removed anon's access, and every SECURITY DEFINER
-- function in the schema shows up as anon-callable. Each of those was checked
-- by hand. Every admin_* function guards itself. The six with no internal role
-- check are activity_availability and activity_slot_availability (counts only,
-- built to be callable), buddies_published and lodging_published (a boolean
-- about an event), can_touch_person_photo (scoped through my_household_ids(),
-- so a logged-out caller gets false), and rls_auto_enable (an event trigger,
-- not reachable as RPC at all).
--
-- Those grants are deliberately NOT revoked here. The is_* and my_* helpers
-- are called from inside RLS policies, and a policy expression runs as the
-- querying role -- revoke EXECUTE from anon and the policy fails rather than
-- returning false. Tidying that safely means checking every policy first, and
-- that is not a change to make in the week before go-live to silence a warning.

alter function public.set_updated_at() set search_path = public;
alter function public.agreement_signature_names_contact() set search_path = public;

comment on function public.set_updated_at() is
  'Stamps updated_at. search_path pinned in 0055 -- a SECURITY DEFINER function that resolves names through the caller''s search_path can be pointed at the caller''s own tables.';
