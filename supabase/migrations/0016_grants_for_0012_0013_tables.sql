-- 0016: role grants missed by migrations 0012 and 0013.
--
-- This database runs least-privilege: new tables start with NO privileges for
-- the API roles, so every new table needs BOTH its RLS policies AND explicit
-- grants (the 0006 lesson, again -- this time for authenticated, not
-- service_role). person_caregivers (0012) and family_change_log (0013) got
-- policies but no grants, so caregiver saves and the Recent Changes page both
-- failed with "permission denied". RLS remains the real row-level gate; these
-- grants only open the table to signed-in users at all.

-- Families manage their own caregiver links (RLS scopes rows + both ends of a
-- link to the caller's household; registrars anywhere).
grant select, insert, update, delete on public.person_caregivers to authenticated;

-- Staff read the change log and mark rows reviewed (RLS: staff-only select,
-- registrar-only update, person_support rows behind the sensitive grant).
-- Inserts come only from the SECURITY DEFINER triggers, so no insert grant.
grant select, update on public.family_change_log to authenticated;
