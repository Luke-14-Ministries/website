-- 0009: "remember this browser" for two-factor (30 days).
--
-- Requiring the 6-digit code at every single login -- with a 15-minute idle
-- logout on staff -- is heavier than it needs to be. The industry-standard
-- middle ground is a trusted browser: the password is still required at every
-- login, but the code is skipped for ~30 days on a browser that has already
-- passed two-factor once.
--
-- The skip must be UNFAKEABLE, so it is verified server-side: a random token
-- lives in the browser's storage, its SHA-256 hash lives here, and login skips
-- the code only when the two match and haven't expired. The insert policy
-- requires aal2 -- a session that has actually passed two-factor -- so an
-- attacker with only a stolen password cannot mint themselves a trusted
-- browser. Removing a factor or clicking "Forget trusted browsers" deletes
-- the rows and the code is required again everywhere.

create table if not exists public.mfa_trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  token_hash   text not null unique,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz not null
);

create index if not exists mfa_trusted_devices_profile_idx
  on public.mfa_trusted_devices (profile_id, expires_at);

alter table public.mfa_trusted_devices enable row level security;

create policy mfa_trusted_select on public.mfa_trusted_devices
  for select to authenticated using (profile_id = (select auth.uid()));

create policy mfa_trusted_insert on public.mfa_trusted_devices
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (select auth.jwt()->>'aal') = 'aal2'
  );

create policy mfa_trusted_update on public.mfa_trusted_devices
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy mfa_trusted_delete on public.mfa_trusted_devices
  for delete to authenticated using (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.mfa_trusted_devices to authenticated;
