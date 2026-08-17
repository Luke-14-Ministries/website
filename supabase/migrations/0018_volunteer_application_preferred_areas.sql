-- 0018: one column the volunteer application form needs that 0001 lacked.
-- Free text ("Buddy, Kitchen & meals") rather than an enum: serving areas
-- change season to season and staff read this with human eyes.
-- Grants: covered by 0001's table-level grant to authenticated (new columns
-- inherit table grants); RLS policies on volunteer_applications unchanged.
-- Applied to production 17 August 2026.

alter table public.volunteer_applications
  add column if not exists preferred_areas text;
