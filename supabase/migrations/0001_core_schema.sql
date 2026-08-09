-- =====================================================================
-- Luke 14 Ministries — camp registration platform
-- Migration 0001: core schema and row-level security
--
-- HOW TO RUN THIS
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole
--   file -> Run. Run migrations in filename order and never edit one
--   after it has been run; write a new numbered file instead. That rule
--   is what makes it possible to rebuild the database from scratch.
--
-- WHY IT LOOKS LIKE THIS
--   Written to be read by a volunteer six months from now, not to be
--   clever. Every non-obvious choice has a comment saying why.
--
--   Four conventions used throughout:
--     * Text columns with CHECK constraints instead of Postgres ENUM
--       types. Adding a value to an enum is a schema migration with
--       transaction restrictions; changing a CHECK constraint is one
--       plain statement a volunteer can write.
--     * cents as integers, never floats. 495.00 stored as 49500. Money
--       in floating point eventually produces $494.99999.
--     * Nothing is stored that can be calculated. No ages, no balances,
--       no totals. A stored copy goes stale silently.
--     * Every table that holds family data has row-level security
--       enabled AND at least one policy. RLS with no policy denies
--       everything; RLS not enabled allows everything. Both failure
--       modes are silent, so both are checked at the end of this file.
--
--   Shape of the model, in one paragraph: a PROFILE is a login, a
--   PERSON is a human being, and a ROLE is something a person holds for
--   one EVENT. Keeping those three apart is what allows one household,
--   with one login, to send a camper and a volunteer to the same week —
--   the thing the current system cannot do without two accounts.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Utility
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. Profiles — one row per login
--
-- Mirrors auth.users, which we do not own and must not write to.
-- Created by a trigger, not by the app: with email confirmation on
-- there is no session immediately after sign-up, so an app-side insert
-- would be refused by row-level security. Correctly.
-- ---------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  first_name    text not null default '',
  last_name     text not null default '',
  phone         text,
  phone_work    text,
  sms_opt_in    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- security definer because the signing-up user has no rights on
-- public.profiles at the moment this fires. search_path is pinned to
-- empty and every name written out in full: a security definer function
-- with a loose search_path can be tricked into running someone else's
-- table or function as the owner.
--
-- The keys read below are set by app/account/signup/SignupForm.jsx in
-- the options.data of signUp(). The names have to match on both sides.
-- Rename one and nothing errors; the profile simply comes out blank,
-- which is a hard thing to notice.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 3. Staff — who works for the ministry, and at what level
--
-- Three levels, deliberately separate from the sensitive-data flag:
--   registrar    — registrations, payments, rosters
--   coordinator  — buddy assignments and activities
--   admin        — everything, including granting the above
--
-- can_view_sensitive is its own column rather than implied by role,
-- because someone can run the rafting sign-up without needing to read
-- every family's medical history. It is held by the registration
-- administrator, the volunteer coordinator and the family coordinator.
-- ---------------------------------------------------------------------

create table public.staff (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  role                text not null default 'registrar'
                        check (role in ('registrar', 'coordinator', 'admin')),
  can_view_sensitive  boolean not null default false,
  title               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- The camp doctor needs full medical detail for the campers at one
-- event, during that event. A physician who volunteers for a week in
-- July should not still hold a key to every family's medical history
-- the following February. Same data, narrower door, and it expires by
-- itself rather than by anyone remembering.
create table public.event_medical_access (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  event_id    uuid not null,   -- FK added after events exists
  starts_on   date not null,
  ends_on     date not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index event_medical_access_profile_idx
  on public.event_medical_access (profile_id, starts_on, ends_on);


-- ---------------------------------------------------------------------
-- 4. Households
--
-- The family unit: one address, one invoice, one place to come back to.
-- Two adults can both hold logins on the same household without one
-- being a guest in the other's account.
-- ---------------------------------------------------------------------

create table public.households (
  id                    uuid primary key default gen_random_uuid(),
  display_name          text not null,
  email                 text,
  phone                 text,
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,
  postal_code           text,
  home_church           text,
  how_did_you_hear      text,
  how_did_you_hear_from text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger households_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  role          text not null default 'adult'
                  check (role in ('owner', 'adult')),
  created_at    timestamptz not null default now(),
  primary key (household_id, profile_id)
);

create index household_members_profile_idx
  on public.household_members (profile_id);


-- ---------------------------------------------------------------------
-- 5. The security helper functions
--
-- Policies call these instead of writing the same subquery fifteen
-- times. All security definer so that they can read staff and
-- household_members without those tables' own policies applying — which
-- is what would otherwise cause a policy to recurse into itself and
-- fail with "infinite recursion detected in policy".
-- ---------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
  );
$$;

create or replace function public.is_registrar()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
      and s.role in ('registrar', 'admin')
  );
$$;

create or replace function public.is_coordinator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
      and s.role in ('coordinator', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active and s.role = 'admin'
  );
$$;

-- The standing grant. Event-scoped medical access is checked separately,
-- in can_view_person_support below, because it depends on which people
-- are involved.
create or replace function public.can_view_sensitive()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active and s.can_view_sensitive
  );
$$;

-- Households the current login belongs to. Returns nothing when not
-- logged in, which makes every policy below deny by default.
create or replace function public.my_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select hm.household_id
  from public.household_members hm
  where hm.profile_id = (select auth.uid());
$$;


-- ---------------------------------------------------------------------
-- 6. People
--
-- Every human the ministry knows about, whether or not they can log in.
-- A nine-year-old camper has a row here and no auth account. A parent
-- has a row here AND a profile, linked by profile_id.
--
-- Deliberately NOT stored, anywhere, ever: social security numbers,
-- insurance policy numbers, photographs of documents, or anything from
-- a background check beyond a yes/no and a date. The volunteer
-- background check runs on the vendor's own site — the applicant enters
-- their number there, and the number never touches this database.
-- ---------------------------------------------------------------------

create table public.people (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  profile_id     uuid references public.profiles (id) on delete set null,
  first_name     text not null,
  last_name      text not null,
  preferred_name text,
  -- Free text rather than a CHECK list. The portal asks it as a
  -- dropdown for bunk and cabin planning; constraining the values in
  -- the database only means a migration the first time the ministry
  -- wants to word it differently.
  gender         text,
  pronouns       text,
  date_of_birth  date,
  -- Age is not stored. It changes every year and a stored copy goes
  -- stale silently; derive it from date_of_birth at the moment you
  -- need it, against the event start date.
  email          text,
  phone          text,
  -- A camper may live at a different address from the account holder:
  -- a group home, a split custody arrangement, an adult camper with
  -- their own place. Null means "same as the household".
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index people_household_idx on public.people (household_id);
create index people_profile_idx on public.people (profile_id);

create trigger people_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();


-- Support needs live in their own table, not as columns on people.
-- Two reasons: it is the most sensitive data in the system and a
-- separate table can carry a stricter policy, and it lets the record
-- be reviewed and re-confirmed without rewriting the person.
--
-- The split between prose and flags is deliberate, and it comes from
-- reading the current portal's own form. Families describe support
-- needs in their own words far better than a checkbox grid does, so
-- the narrative fields stay free text. But a handful of these are
-- questions staff FILTER on rather than read — "who at this camp has
-- seizure risk" gets asked at the start of every week and has to be
-- answerable in one look, not by reading sixty paragraphs. Those are
-- booleans sitting alongside the prose that explains them.
create table public.person_support (
  person_id                 uuid primary key references public.people (id) on delete cascade,

  -- Narrative. Prose, for humans to read.
  disabilities              text,
  medications               text,   -- what, and when each is taken
  daily_living_supports     text,
  mobility                  text,
  personal_care             text,
  communication             text,
  allergy_detail            text,   -- including treatment needed, e.g. EpiPen
  dietary_needs             text,
  rescue_medication_detail  text,
  -- Two halves of a behaviour support plan, and the most useful thing a
  -- buddy can read before nine o'clock on Monday morning. Kept as two
  -- fields because the trigger and the response are different answers.
  behaviour_triggers        text,
  redirection_strategies    text,
  sleep_notes               text,
  other_concerns            text,

  -- Operational flags. These are what the roster filters on.
  has_allergies             boolean not null default false,
  has_seizures              boolean not null default false,
  has_rescue_medication     boolean not null default false,
  has_sleep_disturbance     boolean not null default false,
  has_caregiver             boolean not null default false,
  buddy_required            boolean not null default false,
  buddy_ratio               text,

  -- Structured, so it can be printed on a roster and dialled. The
  -- current portal collects this as one free-text blob, which is fine
  -- until somebody needs to phone it in a hurry.
  emergency_contact_name         text,
  emergency_contact_phone        text,
  emergency_contact_relationship text,

  -- Support needs belong to the person and persist between events, but
  -- medical information three years old with no way to tell its age is
  -- worse than no information. The family is shown what is on file and
  -- asked to confirm it at each registration; this records that they
  -- did, and when.
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);

create trigger person_support_updated_at
  before update on public.person_support
  for each row execute function public.set_updated_at();


-- One identification photograph per person, for check-in and buddy
-- matching. Never used publicly — media consent is a separate thing
-- entirely, below. Only the storage path is held here; the file lives
-- in Supabase Storage under a bucket with its own access rules.
create table public.person_photos (
  person_id     uuid primary key references public.people (id) on delete cascade,
  storage_path  text not null,
  uploaded_at   timestamptz not null default now(),
  -- Kept one year, with a prompt to refresh at the next registration
  -- and the option to keep the previous one. A date rather than a
  -- policy note, so a scheduled job can act on it.
  retain_until  date not null default (current_date + interval '1 year')::date,
  uploaded_by   uuid references public.profiles (id) on delete set null
);


-- Media consent. Separate from the identification photo, recorded per
-- PERSON rather than per household, and changeable.
--
-- Per person because a volunteer consents for themselves, a parent
-- consents for a minor child, and for an adult camper under
-- guardianship the record has to say who answered. Append-only: a
-- withdrawal is a new row, so the history of what was permitted when
-- survives. The latest row for a person is the current answer.
--
-- The promise this represents is narrower than it looks, and the
-- wording beside the checkbox has to match it: the ministry undertakes
-- not to FEATURE someone as a subject of published material. It cannot
-- guarantee they will not appear incidentally in a wide group shot or
-- the whole-camp photograph. Two volunteer photographers take upwards
-- of a thousand frames in a week; a blanket promise is undeliverable,
-- and an undeliverable promise is worse than an honest limit.
create table public.person_media_consent (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.people (id) on delete cascade,
  granted        boolean not null,
  recorded_at    timestamptz not null default now(),
  recorded_by    uuid references public.profiles (id) on delete set null,
  -- "self", "parent", "guardian" — who gave this answer on whose behalf
  recorded_as    text,
  note           text
);

create index person_media_consent_person_idx
  on public.person_media_consent (person_id, recorded_at desc);


-- Whether the current login may read one person's support record.
-- True if the person is in the viewer's own household, or the viewer
-- holds the standing sensitive grant, or the viewer has an in-date
-- event medical grant for an event this person is registered for.
--
-- Defined here as a stub and replaced after registrations exists, so
-- that the policies below can reference it in file order.
create or replace function public.can_view_person_support(p_person_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    public.can_view_sensitive()
    or exists (
      select 1 from public.people p
      where p.id = p_person_id
        and p.household_id in (select public.my_household_ids())
    );
$$;


-- ---------------------------------------------------------------------
-- 7. Seasons and events
--
-- "Event" replaces what an earlier draft called a session, and
-- generalises it. Camp Celebrate week 2, the fall Adventure Retreat and
-- a Luke 14 dinner are all events; camp-specific fields are optional
-- rather than assumed, so a dinner does not have to pretend to be a
-- week of summer camp with a deposit.
-- ---------------------------------------------------------------------

create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null,
  name        text not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (year, name)
);

create table public.events (
  id                      uuid primary key default gen_random_uuid(),
  season_id               uuid references public.seasons (id) on delete restrict,
  name                    text not null,
  event_type              text not null default 'camp_week'
                            check (event_type in ('camp_week', 'retreat', 'dinner', 'other')),
  description             text,
  starts_on               date not null,
  ends_on                 date not null,
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  deposit_cents           integer not null default 0 check (deposit_cents >= 0),
  location                text,
  -- Null means unlimited, which is what the current system shows for
  -- week 2 and the retreat. Week 1 is capped at 230.
  capacity                integer check (capacity is null or capacity >= 0),
  published               boolean not null default false,
  -- Null means buddy assignments are visible to coordinators and staff
  -- only. Setting it publishes them to families and volunteers. Never
  -- setting it is a perfectly valid permanent state: matches are fluid
  -- up to and beyond the first morning, and a published list that keeps
  -- changing is worse than no list.
  buddy_assignments_published_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index events_season_idx on public.events (season_id);

create trigger events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

alter table public.event_medical_access
  add constraint event_medical_access_event_fk
  foreign key (event_id) references public.events (id) on delete cascade;


-- What a person actually signs up for: an event crossed with a role.
-- "Adult Adventure Retreat: Camper" and "Adult Adventure Retreat:
-- Volunteer" are two options on one event, each with its own fee and
-- its own capacity — which is how camp can be full of families while
-- still needing buddies.
create table public.event_options (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  name                text not null,
  description         text,
  -- Nullable on purpose. The retreat publishes two options, one per
  -- role. Camp Celebrate publishes ONE option per week carrying the
  -- note "this enrollment is for both Volunteers and Camper Families",
  -- and the role comes from the person's own pre-enrollment answer
  -- instead. Null here means "this option does not decide the role".
  participant_role    text
                        check (participant_role is null or
                               participant_role in ('camper', 'parent_guardian', 'sibling',
                                                    'caregiver', 'volunteer', 'childcare',
                                                    'support_team')),
  fee_cents           integer not null default 0 check (fee_cents >= 0),
  deposit_cents       integer check (deposit_cents is null or deposit_cents >= 0),
  capacity            integer check (capacity is null or capacity >= 0),
  -- Early-bird pricing is a date-effective price, held here rather than
  -- in Stripe. Everything a family owes is worked out in this database
  -- and Stripe is handed one settled figure: two pricing engines
  -- eventually disagree, and that is the day the treasurer cannot
  -- reconcile the year.
  early_bird_fee_cents integer check (early_bird_fee_cents is null or early_bird_fee_cents >= 0),
  early_bird_ends_on   date,
  published           boolean not null default false,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index event_options_event_idx on public.event_options (event_id);

create trigger event_options_updated_at
  before update on public.event_options
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 8. Activities
--
-- Managed by an administrator, not by a developer. Adding "Zip Line"
-- next summer means choosing a mode from a dropdown, not a code change.
--
-- Three booking modes, because the real ones behave differently:
--   interest    — archery, climbing wall, horses. A headcount so camp
--                 can plan. No commitment, no capacity.
--   signup      — rafting. A real list, usually with a waiver attached.
--   appointment — the salon, massage, pontoon rides. A named time slot.
-- ---------------------------------------------------------------------

create table public.activities (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  name              text not null,
  description       text,
  booking_mode      text not null default 'interest'
                      check (booking_mode in ('interest', 'signup', 'appointment')),
  capacity          integer check (capacity is null or capacity >= 0),
  fee_cents         integer not null default 0 check (fee_cents >= 0),
  -- The provider's own booking or waiver link, when the activity is run
  -- by somebody else. This exists because of a real failure: several
  -- people signed a rafting waiver last year without using the group
  -- link, so their signatures never reached the ministry's list and
  -- nobody found out until camp. One canonical link, held here, served
  -- from the sign-up screen and repeated in the confirmation email, is
  -- most of the fix.
  provider_name     text,
  provider_url      text,
  signup_opens_at   timestamptz,
  signup_closes_at  timestamptz,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index activities_event_idx on public.activities (event_id);

create trigger activities_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- Only meaningful when booking_mode = 'appointment'.
create table public.activity_slots (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  capacity     integer not null default 1 check (capacity >= 0),
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index activity_slots_activity_idx on public.activity_slots (activity_id, starts_at);


-- ---------------------------------------------------------------------
-- 9. Registrations
--
-- One registration per household per event: the submission, the
-- invoice, the place the family comes back to. The people actually
-- attending are rows in registration_participants, because a household
-- does not send the same people every year and does not send them in
-- the same roles.
-- ---------------------------------------------------------------------

create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete restrict,
  event_id      uuid not null references public.events (id) on delete restrict,
  family_notes  text,          -- "anything else we should know?"
  -- There is deliberately no staff_notes column here. Staff comments
  -- live in registration_notes, a separate table, because row-level
  -- security controls which ROWS you see and not which COLUMNS. A
  -- staff-only column on a row the family is allowed to read is a
  -- column the family can read. Postgres does offer column privileges,
  -- but a table-level SELECT grant overrides them, so getting it right
  -- means revoking table SELECT and re-granting every other column by
  -- name — and then remembering to do that again for every column
  -- added afterwards. A second table cannot be got wrong by forgetting.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, event_id)
);

create index registrations_event_idx on public.registrations (event_id);

create trigger registrations_updated_at
  before update on public.registrations
  for each row execute function public.set_updated_at();


-- One row per person per option. This is where the real work happens.
--
-- Status lives HERE and not on the registration as a whole, because one
-- camper confirmed while a sibling is waitlisted is an ordinary
-- situation and has to be expressible.
create table public.registration_participants (
  id                uuid primary key default gen_random_uuid(),
  registration_id   uuid not null references public.registrations (id) on delete cascade,
  person_id         uuid not null references public.people (id) on delete restrict,
  event_option_id   uuid not null references public.event_options (id) on delete restrict,
  -- The authoritative role for this person at this event. Copied from
  -- the option when the option pins one, taken from the pre-enrollment
  -- answer when it does not.
  camp_role         text not null default 'camper'
                      check (camp_role in ('camper', 'parent_guardian', 'sibling',
                                           'caregiver', 'volunteer', 'childcare',
                                           'support_team')),
  status            text not null default 'draft'
                      check (status in ('draft', 'submitted', 'waitlisted',
                                        'confirmed', 'cancelled')),
  -- Lifecycle only. Whether money has arrived is answered by the
  -- payments table and the registration_balances view, never by this
  -- column. Two sources of truth for "have they paid" is how a family
  -- gets chased for a fee they already sent.
  submitted_at      timestamptz,
  confirmed_at      timestamptz,
  cancelled_at      timestamptz,
  cancellation_note text,

  -- What this person owes, worked out here. fee_cents is copied from
  -- the option at the moment of registration rather than read live,
  -- because a family who registered in March at the early-bird rate
  -- keeps that rate when the price changes in May.
  fee_cents         integer not null default 0 check (fee_cents >= 0),
  discount_cents    integer not null default 0 check (discount_cents >= 0),
  scholarship_cents integer not null default 0 check (scholarship_cents >= 0),

  -- The enrollment questions. Ordinary columns rather than a
  -- general-purpose custom-question system: rebuilding a form builder
  -- is a season's work, the ministry's questions are fairly static, and
  -- adding one here is a small change plus a migration.
  tshirt_size            text,
  first_time_attending   boolean,
  heard_about            text,
  heard_about_from       text,

  -- Progress. Most of it is derivable from what else exists — which
  -- forms are signed, which questions answered — but the furthest step
  -- reached tells the portal where to drop someone back in, and the
  -- last-activity time is what lets a registrar see who stalled.
  --
  -- Saving is the default, not a step: every answer persists as it is
  -- entered, incomplete ones included. Systems that only store data
  -- passing validation are what force a family to finish in one
  -- sitting, and a half-typed medication list should survive a closed
  -- laptop.
  furthest_step     integer not null default 1 check (furthest_step between 1 and 5),
  last_activity_at  timestamptz not null default now(),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (registration_id, person_id, event_option_id)
);

create index registration_participants_person_idx
  on public.registration_participants (person_id);
create index registration_participants_registration_idx
  on public.registration_participants (registration_id);
create index registration_participants_option_idx
  on public.registration_participants (event_option_id, status);

create trigger registration_participants_updated_at
  before update on public.registration_participants
  for each row execute function public.set_updated_at();


-- Staff comments on a registration. Never visible to the family, and
-- append-only in practice: staff add a note rather than editing the
-- last one, so the history of a difficult conversation survives.
create table public.registration_notes (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index registration_notes_registration_idx
  on public.registration_notes (registration_id);


-- Now that registrations exist, the support-record visibility helper can
-- take account of the camp doctor's event-scoped grant.
create or replace function public.can_view_person_support(p_person_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    public.can_view_sensitive()
    or exists (
      select 1 from public.people p
      where p.id = p_person_id
        and p.household_id in (select public.my_household_ids())
    )
    or exists (
      select 1
      from public.event_medical_access a
      join public.registrations r on r.event_id = a.event_id
      join public.registration_participants rp on rp.registration_id = r.id
      where a.profile_id = (select auth.uid())
        and rp.person_id = p_person_id
        and current_date between a.starts_on and a.ends_on
    );
$$;


-- ---------------------------------------------------------------------
-- 10. Activity sign-ups
--
-- Not all sign-ups happen at registration. A camper talked into rafting
-- on the Tuesday has to be added on the spot, and whatever waiver that
-- activity requires has to appear at that moment. Hence the timestamp
-- and the record of who added it.
-- ---------------------------------------------------------------------

create table public.activity_signups (
  id                          uuid primary key default gen_random_uuid(),
  registration_participant_id uuid not null
                                references public.registration_participants (id) on delete cascade,
  activity_id                 uuid not null references public.activities (id) on delete cascade,
  slot_id                     uuid references public.activity_slots (id) on delete set null,
  status                      text not null default 'signed_up'
                                check (status in ('interested', 'signed_up', 'cancelled')),
  added_by                    uuid references public.profiles (id) on delete set null,
  added_source                text not null default 'family'
                                check (added_source in ('family', 'staff')),
  note                        text,
  created_at                  timestamptz not null default now(),
  unique (registration_participant_id, activity_id)
);

create index activity_signups_activity_idx
  on public.activity_signups (activity_id, status);


-- ---------------------------------------------------------------------
-- 11. Volunteers
--
-- background_check_on_file is a boolean and a date. The paperwork
-- itself lives in the permission-restricted SharePoint folder and never
-- enters this database, this repository, or an email. That is a
-- ministry rule agreed at board level, not a preference.
-- ---------------------------------------------------------------------

create table public.volunteer_applications (
  id                          uuid primary key default gen_random_uuid(),
  registration_participant_id uuid not null
                                references public.registration_participants (id) on delete cascade,
  first_time_volunteering     boolean,
  church_attendance           text,
  faith_statement             text,
  relevant_skills             text,
  disability_experience       text,
  -- A minor may volunteer accompanied by a parent or guardian, who is
  -- usually a fellow volunteer but occasionally someone in a camper
  -- family. So this points at a PERSON, not at somebody inside the same
  -- registration. A minor with nobody named appears on a staff report
  -- rather than being blocked mid-form: a hard block gets worked around
  -- by typing a wrong name, which is worse than knowing it is
  -- outstanding.
  accompanying_adult_person_id uuid references public.people (id) on delete set null,
  status                      text not null default 'applied'
                                check (status in ('applied', 'approved', 'declined', 'withdrawn')),
  reviewed_by                 uuid references public.profiles (id) on delete set null,
  reviewed_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (registration_participant_id)
);

create trigger volunteer_applications_updated_at
  before update on public.volunteer_applications
  for each row execute function public.set_updated_at();

create table public.volunteer_clearances (
  person_id                 uuid primary key references public.people (id) on delete cascade,
  background_check_on_file  boolean not null default false,
  background_check_date     date,
  expires_on                date,
  recorded_by               uuid references public.profiles (id) on delete set null,
  updated_at                timestamptz not null default now()
);

create trigger volunteer_clearances_updated_at
  before update on public.volunteer_clearances
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 12. Buddy assignments
--
-- Many-to-many, because one buddy can cover several campers whose needs
-- are light. Scoped to the event.
--
-- Assignments are NOT deleted when they change. The old row is closed
-- out with ended_at and a new one opens. That gives a record of how the
-- week actually went at no cost to anyone, and means a swap made in a
-- corridor on Wednesday morning does not erase what was true on
-- Tuesday.
-- ---------------------------------------------------------------------

create table public.buddy_assignments (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events (id) on delete cascade,
  buddy_participant_id  uuid not null
                          references public.registration_participants (id) on delete cascade,
  camper_participant_id uuid not null
                          references public.registration_participants (id) on delete cascade,
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  assigned_by           uuid references public.profiles (id) on delete set null,
  note                  text,
  check (buddy_participant_id <> camper_participant_id)
);

create index buddy_assignments_event_idx on public.buddy_assignments (event_id);
create index buddy_assignments_buddy_idx on public.buddy_assignments (buddy_participant_id);
create index buddy_assignments_camper_idx on public.buddy_assignments (camper_participant_id);

-- At most one live assignment per camper-buddy pair. Closed-out rows
-- are unconstrained, so the same pair can be re-made later.
create unique index buddy_assignments_live_idx
  on public.buddy_assignments (buddy_participant_id, camper_participant_id)
  where ended_at is null;


-- ---------------------------------------------------------------------
-- 13. Agreements — waivers, consents, releases
--
-- Versioned, because "she signed the waiver" is worth nothing if nobody
-- can say which waiver.
--
-- Two delivery types, and the difference is not cosmetic. For a
-- document the ministry serves, we hold an actual signature and must be
-- able to render it back out as a file — the Camp Carson facility
-- waiver is signed here and relayed to the campground. For an outside
-- provider's link, the signature lives on their system and we cannot
-- have it; what we can hold is evidence that somebody checked. A green
-- tick that blurs those together is a green tick that cannot answer a
-- question months later.
-- ---------------------------------------------------------------------

create table public.agreements (
  id            uuid primary key default gen_random_uuid(),
  key           text not null,          -- stable slug: 'media_consent', 'hold_harmless'
  version       integer not null default 1,
  title         text not null,
  body          text,                   -- the text as signed, for internal documents
  delivery      text not null default 'internal_document'
                  check (delivery in ('internal_document', 'external_link')),
  external_url  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (key, version),
  check (delivery <> 'external_link' or external_url is not null)
);

-- Which agreement is required for what. Exactly one of event_id or
-- activity_id — an agreement is either a condition of attending the
-- event or a condition of doing one activity.
--
-- is_required is per agreement rather than all-or-nothing. The current
-- portal bundles seven consents into one mandatory block, which means a
-- family cannot attend without agreeing that photographs of their child
-- may be used publicly. Liability and emergency treatment genuinely
-- gate attendance; media consent should be a real choice. One column
-- makes that expressible.
create table public.agreement_requirements (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references public.agreements (id) on delete cascade,
  event_id      uuid references public.events (id) on delete cascade,
  activity_id   uuid references public.activities (id) on delete cascade,
  applies_to    text not null default 'participant'
                  check (applies_to in ('household', 'participant')),
  is_required   boolean not null default true,
  due_on        date,
  created_at    timestamptz not null default now(),
  check (num_nonnulls(event_id, activity_id) = 1)
);

create index agreement_requirements_event_idx on public.agreement_requirements (event_id);
create index agreement_requirements_activity_idx on public.agreement_requirements (activity_id);


-- Four states, and they are different claims about the world:
--   self_reported      — the family says they have done it. Not proof,
--                        but it lets staff chase the not-even-claimed
--                        pile in June instead of the week before camp.
--   signed_here        — we hold an actual signature.
--   confirmed_external — a staff member cross-referenced the provider's
--                        list and ticked this person off. We hold
--                        evidence that somebody checked.
--   paper_on_file      — signed on the day, recorded by staff.
--
-- We record the FACT, not the document, for external agreements. The
-- provider emails the family a link to their signed PDF; the ministry
-- does not need that file and should not hold it.
create table public.agreement_signatures (
  id              uuid primary key default gen_random_uuid(),
  agreement_id    uuid not null references public.agreements (id) on delete restrict,
  person_id       uuid references public.people (id) on delete cascade,
  household_id    uuid references public.households (id) on delete cascade,
  registration_id uuid references public.registrations (id) on delete set null,
  status          text not null
                    check (status in ('self_reported', 'signed_here',
                                      'confirmed_external', 'paper_on_file')),
  signed_at       timestamptz not null default now(),
  signer_name     text,          -- as typed, for internally-signed documents
  signer_role     text,          -- 'self', 'parent', 'guardian'
  confirmed_by    uuid references public.profiles (id) on delete set null,
  document_path   text,          -- internal documents only; never an external provider's file
  note            text,
  check (num_nonnulls(person_id, household_id) = 1)
);

create index agreement_signatures_person_idx on public.agreement_signatures (person_id);
create index agreement_signatures_household_idx on public.agreement_signatures (household_id);
create index agreement_signatures_agreement_idx on public.agreement_signatures (agreement_id, status);


-- ---------------------------------------------------------------------
-- 14. Money
--
-- All the arithmetic happens here. Stripe is handed one settled figure
-- to collect. Partly cost — Stripe charges extra for its own invoicing
-- and subscription-billing products, and this project exists to get
-- fees down from 6% — but mostly because what a family owes must be
-- answerable from one place.
-- ---------------------------------------------------------------------

-- The treasurer's chart of accounts. The current system keeps a list
-- like this — tuition, deposit, discounts, scholarships, donations,
-- cancellation fee, processing fee — with a general-ledger code column
-- beside each. The codes are unfilled there; holding them here is what
-- lets a year's money be exported straight into the books.
create table public.transaction_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  gl_code     text,
  kind        text not null default 'fee'
                check (kind in ('fee', 'deposit', 'discount', 'scholarship',
                                'donation', 'refund', 'other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);


-- Rule-based discounts, which are a different thing from coupon codes.
-- The current system runs three: a multi-camper discount, an early
-- registration discount applied by hand, and $200 off a volunteer's
-- second week — none of which involve anyone typing a code.
--
-- The RULE is implemented in code; only the amount, the mode and
-- whether it is switched on live here. Encoding arbitrary rules as data
-- is the form-builder trap in another costume: it looks flexible and
-- then nobody can debug it.
create table public.discount_rules (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid references public.events (id) on delete cascade,
  name              text not null,
  rule_key          text not null
                      check (rule_key in ('multi_participant', 'second_week_volunteer',
                                          'early_registration', 'manual')),
  mode              text not null default 'automatic'
                      check (mode in ('automatic', 'manual')),
  amount_off_cents  integer check (amount_off_cents is null or amount_off_cents > 0),
  percent_off       numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  category_id       uuid references public.transaction_categories (id) on delete set null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  check (num_nonnulls(amount_off_cents, percent_off) = 1)
);

create index discount_rules_event_idx on public.discount_rules (event_id, active);


create table public.coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  description       text,
  percent_off       numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents  integer check (amount_off_cents is null or amount_off_cents > 0),
  -- 1 for a single-use code, higher for a shared one, null for
  -- unlimited.
  max_redemptions   integer check (max_redemptions is null or max_redemptions > 0),
  times_redeemed    integer not null default 0 check (times_redeemed >= 0),
  min_amount_cents  integer check (min_amount_cents is null or min_amount_cents >= 0),
  -- Restrict a code to one family when it is a hardship arrangement
  -- rather than a promotion.
  household_id      uuid references public.households (id) on delete cascade,
  starts_at         timestamptz,
  expires_at        timestamptz,
  active            boolean not null default true,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  check (num_nonnulls(percent_off, amount_off_cents) = 1)
);

create table public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete restrict,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  applied_cents   integer not null check (applied_cents >= 0),
  redeemed_at     timestamptz not null default now(),
  unique (coupon_id, registration_id)
);


create table public.scholarships (
  id                          uuid primary key default gen_random_uuid(),
  registration_participant_id uuid not null
                                references public.registration_participants (id) on delete cascade,
  requested_cents             integer check (requested_cents is null or requested_cents >= 0),
  granted_cents               integer not null default 0 check (granted_cents >= 0),
  status                      text not null default 'requested'
                                check (status in ('requested', 'granted', 'declined', 'withdrawn')),
  family_statement            text,
  reviewed_by                 uuid references public.profiles (id) on delete set null,
  reviewed_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (registration_participant_id)
);

create trigger scholarships_updated_at
  before update on public.scholarships
  for each row execute function public.set_updated_at();


-- A plan is a schedule of statements, not a standing authority to draw
-- on a card.
--
-- The ministry does not store a card and charge it. When the ministry
-- can initiate a charge, every bug, mis-set date and duplicated row is
-- capable of taking money out of a family's account with nobody present
-- — which has already happened once under the previous system, where an
-- unauthorised draft bounced and cost more to unpick than the payment
-- was worth. A wrong number in a statement email is embarrassing and
-- fixable by apologising. A wrong number in an automatic draft is
-- somebody's rent.
-- Named, reusable schedules defined by an administrator per season —
-- the current system has "Camp Celebrate 2026", "YA Adventure 2026" and
-- so on. A family's plan points at one of these rather than inventing
-- its own dates.
create table public.payment_schedules (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events (id) on delete cascade,
  name        text not null,
  cadence     text not null default 'monthly'
                check (cadence in ('in_full', 'monthly', 'semi_monthly', 'flexible')),
  first_due_on date,
  final_due_on date,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.payment_plans (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  payment_schedule_id uuid references public.payment_schedules (id) on delete set null,
  schedule        text not null default 'in_full'
                    check (schedule in ('in_full', 'monthly', 'semi_monthly', 'flexible')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (registration_id)
);

create trigger payment_plans_updated_at
  before update on public.payment_plans
  for each row execute function public.set_updated_at();

create table public.payment_installments (
  id                uuid primary key default gen_random_uuid(),
  payment_plan_id   uuid not null references public.payment_plans (id) on delete cascade,
  due_on            date not null,
  amount_cents      integer not null check (amount_cents >= 0),
  status            text not null default 'scheduled'
                      check (status in ('scheduled', 'sent', 'paid', 'waived', 'cancelled')),
  statement_sent_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index payment_installments_plan_idx
  on public.payment_installments (payment_plan_id, due_on);

create trigger payment_installments_updated_at
  before update on public.payment_installments
  for each row execute function public.set_updated_at();


create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  registration_id          uuid not null references public.registrations (id) on delete restrict,
  installment_id           uuid references public.payment_installments (id) on delete set null,
  amount_cents             integer not null check (amount_cents > 0),
  category_id              uuid references public.transaction_categories (id) on delete set null,
  method                   text not null
                             check (method in ('card', 'bank_transfer', 'check', 'cash', 'other')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'processing', 'succeeded',
                                               'failed', 'refunded')),
  -- Bank transfer is delayed-notification: the money is not there when
  -- the family clicks the button. Holding the expected date stops a
  -- family being chased for a fee they already sent.
  expected_settlement_on   date,
  received_on              date,
  stripe_payment_intent_id text,
  -- Cheques and cash are entered by staff, and it matters who entered
  -- them.
  recorded_by              uuid references public.profiles (id) on delete set null,
  note                     text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index payments_registration_idx on public.payments (registration_id, status);

create trigger payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();


-- What is owed is CALCULATED, never stored. A stored balance drifts,
-- and the day it drifts is the day a family is chased for a fee they
-- already paid.
--
-- security_invoker = true means this view runs with the permissions of
-- whoever queries it, so the row-level policies on the tables beneath
-- still apply. Without it a view is a hole straight through RLS.
create view public.registration_balances
with (security_invoker = true) as
select
  r.id                                         as registration_id,
  r.household_id,
  r.event_id,
  coalesce(f.fee_cents, 0)                     as fee_cents,
  coalesce(f.discount_cents, 0)                as discount_cents,
  coalesce(f.scholarship_cents, 0)             as scholarship_cents,
  coalesce(c.coupon_cents, 0)                  as coupon_cents,
  coalesce(p.paid_cents, 0)                    as paid_cents,
  coalesce(f.fee_cents, 0)
    - coalesce(f.discount_cents, 0)
    - coalesce(f.scholarship_cents, 0)
    - coalesce(c.coupon_cents, 0)
    - coalesce(p.paid_cents, 0)                as balance_cents
from public.registrations r
left join (
  select rp.registration_id,
         sum(rp.fee_cents)         as fee_cents,
         sum(rp.discount_cents)    as discount_cents,
         sum(rp.scholarship_cents) as scholarship_cents
  from public.registration_participants rp
  where rp.status <> 'cancelled'
  group by rp.registration_id
) f on f.registration_id = r.id
left join (
  select cr.registration_id, sum(cr.applied_cents) as coupon_cents
  from public.coupon_redemptions cr
  group by cr.registration_id
) c on c.registration_id = r.id
left join (
  select pm.registration_id, sum(pm.amount_cents) as paid_cents
  from public.payments pm
  where pm.status in ('succeeded', 'processing')
  group by pm.registration_id
) p on p.registration_id = r.id;


-- ---------------------------------------------------------------------
-- 15. Message log
--
-- Every automated email: who it went to, which template, when.
--
-- Not housekeeping. "We told you on the first" is a claim the ministry
-- will need to make occasionally, and it should be answerable from a
-- record rather than from memory. It also keeps the stalled-registration
-- outreach honest — staff can see whether a family who never finished
-- was ever actually reminded.
-- ---------------------------------------------------------------------

create table public.message_log (
  id                  uuid primary key default gen_random_uuid(),
  to_email            text not null,
  person_id           uuid references public.people (id) on delete set null,
  household_id        uuid references public.households (id) on delete set null,
  registration_id     uuid references public.registrations (id) on delete set null,
  template_key        text not null,
  subject             text,
  status              text not null default 'sent'
                        check (status in ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  provider_message_id text,
  error               text,
  sent_at             timestamptz not null default now()
);

create index message_log_household_idx on public.message_log (household_id, sent_at desc);
create index message_log_registration_idx on public.message_log (registration_id, sent_at desc);


-- ---------------------------------------------------------------------
-- 16. Two more helpers, now that registrations exist
-- ---------------------------------------------------------------------

create or replace function public.my_registration_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.registrations r
  where r.household_id in (
    select hm.household_id from public.household_members hm
    where hm.profile_id = (select auth.uid())
  );
$$;

create or replace function public.my_participant_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select rp.id
  from public.registration_participants rp
  join public.registrations r on r.id = rp.registration_id
  where r.household_id in (
    select hm.household_id from public.household_members hm
    where hm.profile_id = (select auth.uid())
  );
$$;

-- Are this event's buddy assignments published to families yet?
create or replace function public.buddies_published(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select e.buddy_assignments_published_at is not null
     from public.events e where e.id = p_event_id),
    false);
$$;


-- ---------------------------------------------------------------------
-- 17. Table privileges
--
-- Privileges decide whether a role may touch a table at all; policies
-- decide which rows. Both are needed — RLS on a table nobody has been
-- granted anything on is simply invisible.
--
-- Note the deliberate absence of column-level grants anywhere in this
-- file. A table-level SELECT grant overrides column privileges, so
-- "this column is staff-only" is not something that can be enforced by
-- revoking a column. Where that separation is needed, the data is in a
-- separate table instead.
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous visitors get read access only to what a public "our camps"
-- page needs. The policies below narrow that to published rows.
grant select on public.seasons, public.events, public.event_options, public.activities
  to anon;

grant execute on all functions in schema public to anon, authenticated;


-- ---------------------------------------------------------------------
-- 18. Row-level security
--
-- Enabled on every table. Note that policies are permissive by default:
-- a row is visible if ANY policy allows it. There is no policy anywhere
-- below that grants access without either a household match or a staff
-- check, so an anonymous or unrelated login sees nothing.
-- ---------------------------------------------------------------------

alter table public.profiles                  enable row level security;
alter table public.staff                     enable row level security;
alter table public.event_medical_access      enable row level security;
alter table public.households                enable row level security;
alter table public.household_members         enable row level security;
alter table public.people                    enable row level security;
alter table public.person_support            enable row level security;
alter table public.person_photos             enable row level security;
alter table public.person_media_consent      enable row level security;
alter table public.seasons                   enable row level security;
alter table public.events                    enable row level security;
alter table public.event_options             enable row level security;
alter table public.activities                enable row level security;
alter table public.activity_slots            enable row level security;
alter table public.activity_signups          enable row level security;
alter table public.registrations             enable row level security;
alter table public.registration_participants enable row level security;
alter table public.registration_notes        enable row level security;
alter table public.volunteer_applications    enable row level security;
alter table public.volunteer_clearances      enable row level security;
alter table public.buddy_assignments         enable row level security;
alter table public.agreements                enable row level security;
alter table public.agreement_requirements    enable row level security;
alter table public.agreement_signatures      enable row level security;
alter table public.transaction_categories    enable row level security;
alter table public.discount_rules            enable row level security;
alter table public.payment_schedules         enable row level security;
alter table public.coupons                   enable row level security;
alter table public.coupon_redemptions        enable row level security;
alter table public.scholarships              enable row level security;
alter table public.payment_plans             enable row level security;
alter table public.payment_installments      enable row level security;
alter table public.payments                  enable row level security;
alter table public.message_log               enable row level security;


-- --- identity ---------------------------------------------------------

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy staff_select on public.staff
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());

create policy staff_write on public.staff
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy event_medical_access_read on public.event_medical_access
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());

create policy event_medical_access_write on public.event_medical_access
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- --- household --------------------------------------------------------

create policy households_select on public.households
  for select to authenticated
  using (id in (select public.my_household_ids()) or public.is_staff());

create policy households_insert on public.households
  for insert to authenticated with check (true);

create policy households_update on public.households
  for update to authenticated
  using (id in (select public.my_household_ids()) or public.is_registrar())
  with check (id in (select public.my_household_ids()) or public.is_registrar());

create policy household_members_select on public.household_members
  for select to authenticated
  using (profile_id = (select auth.uid())
         or household_id in (select public.my_household_ids())
         or public.is_staff());

create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (profile_id = (select auth.uid())
              or household_id in (select public.my_household_ids())
              or public.is_registrar());

create policy people_select on public.people
  for select to authenticated
  using (household_id in (select public.my_household_ids()) or public.is_staff());

create policy people_insert on public.people
  for insert to authenticated
  with check (household_id in (select public.my_household_ids()) or public.is_registrar());

create policy people_update on public.people
  for update to authenticated
  using (household_id in (select public.my_household_ids()) or public.is_registrar())
  with check (household_id in (select public.my_household_ids()) or public.is_registrar());

create policy people_delete on public.people
  for delete to authenticated
  using (household_id in (select public.my_household_ids()) or public.is_registrar());


-- --- the sensitive tier -----------------------------------------------
--
-- Support records, photographs and medical detail. Readable by the
-- family it belongs to, by staff holding the standing sensitive grant,
-- and by a camp doctor with an in-date grant for an event this person
-- is attending. Everyone else on staff sees rosters and payment status
-- and nothing here.

create policy person_support_select on public.person_support
  for select to authenticated
  using (public.can_view_person_support(person_id));

create policy person_support_write on public.person_support
  for all to authenticated
  using (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.can_view_sensitive()
  )
  with check (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.can_view_sensitive()
  );

create policy person_photos_select on public.person_photos
  for select to authenticated
  using (public.can_view_person_support(person_id));

create policy person_photos_write on public.person_photos
  for all to authenticated
  using (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.can_view_sensitive()
  )
  with check (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.can_view_sensitive()
  );

create policy person_media_consent_select on public.person_media_consent
  for select to authenticated
  using (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.is_staff()
  );

create policy person_media_consent_insert on public.person_media_consent
  for insert to authenticated
  with check (
    exists (select 1 from public.people p
            where p.id = person_id
              and p.household_id in (select public.my_household_ids()))
    or public.is_registrar()
  );


-- --- the catalogue: what is on offer ----------------------------------

create policy seasons_select on public.seasons
  for select to anon, authenticated using (true);

create policy seasons_write on public.seasons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy events_select on public.events
  for select to anon, authenticated
  using (published or public.is_staff());

create policy events_write on public.events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy event_options_select on public.event_options
  for select to anon, authenticated
  using (
    public.is_staff()
    or (published and exists (select 1 from public.events e
                              where e.id = event_id and e.published))
  );

create policy event_options_write on public.event_options
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy activities_select on public.activities
  for select to anon, authenticated
  using (
    public.is_staff()
    or (active and exists (select 1 from public.events e
                           where e.id = event_id and e.published))
  );

create policy activities_write on public.activities
  for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());

create policy activity_slots_select on public.activity_slots
  for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.activities a
               join public.events e on e.id = a.event_id
               where a.id = activity_id and a.active and e.published)
  );

create policy activity_slots_write on public.activity_slots
  for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());


-- --- registrations ----------------------------------------------------

create policy registrations_select on public.registrations
  for select to authenticated
  using (household_id in (select public.my_household_ids()) or public.is_staff());

create policy registrations_insert on public.registrations
  for insert to authenticated
  with check (household_id in (select public.my_household_ids()));

create policy registrations_update on public.registrations
  for update to authenticated
  using (household_id in (select public.my_household_ids()) or public.is_registrar())
  with check (household_id in (select public.my_household_ids()) or public.is_registrar());

create policy registration_participants_select on public.registration_participants
  for select to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_staff());

create policy registration_participants_insert on public.registration_participants
  for insert to authenticated
  with check (registration_id in (select public.my_registration_ids()) or public.is_registrar());

-- A family may edit their own rows; only a registrar may move one to
-- confirmed or waitlisted. The status check is in WITH CHECK rather
-- than USING so that a family editing a draft is not silently rejected
-- for reading it.
create policy registration_participants_update on public.registration_participants
  for update to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_registrar())
  with check (
    public.is_registrar()
    or (registration_id in (select public.my_registration_ids())
        and status in ('draft', 'submitted', 'cancelled'))
  );

create policy registration_participants_delete on public.registration_participants
  for delete to authenticated
  using (
    public.is_registrar()
    or (registration_id in (select public.my_registration_ids()) and status = 'draft')
  );

-- Staff notes: never visible to a family, in any circumstance.
create policy registration_notes_select on public.registration_notes
  for select to authenticated using (public.is_staff());

create policy registration_notes_insert on public.registration_notes
  for insert to authenticated with check (public.is_staff());


-- --- activity sign-ups ------------------------------------------------

create policy activity_signups_select on public.activity_signups
  for select to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_staff());

create policy activity_signups_write on public.activity_signups
  for all to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_coordinator())
  with check (registration_participant_id in (select public.my_participant_ids())
              or public.is_coordinator());


-- --- volunteers -------------------------------------------------------

create policy volunteer_applications_select on public.volunteer_applications
  for select to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_staff());

create policy volunteer_applications_insert on public.volunteer_applications
  for insert to authenticated
  with check (registration_participant_id in (select public.my_participant_ids()));

create policy volunteer_applications_update on public.volunteer_applications
  for update to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_registrar())
  with check (
    public.is_registrar()
    or (registration_participant_id in (select public.my_participant_ids())
        and status in ('applied', 'withdrawn'))
  );

-- Clearances are staff-only in both directions. A family has no reason
-- to read, and no business writing, whether a background check is on
-- file.
create policy volunteer_clearances_staff on public.volunteer_clearances
  for all to authenticated
  using (public.is_registrar()) with check (public.is_registrar());


-- --- buddies ----------------------------------------------------------
--
-- Coordinators and staff always. Families and volunteers only once the
-- event's assignments have been published, and only their own.

create policy buddy_assignments_select on public.buddy_assignments
  for select to authenticated
  using (
    public.is_staff()
    or (public.buddies_published(event_id)
        and (buddy_participant_id in (select public.my_participant_ids())
             or camper_participant_id in (select public.my_participant_ids())))
  );

create policy buddy_assignments_write on public.buddy_assignments
  for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());


-- --- agreements -------------------------------------------------------

create policy agreements_select on public.agreements
  for select to authenticated using (true);

create policy agreements_write on public.agreements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy agreement_requirements_select on public.agreement_requirements
  for select to authenticated using (true);

create policy agreement_requirements_write on public.agreement_requirements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy agreement_signatures_select on public.agreement_signatures
  for select to authenticated
  using (
    public.is_staff()
    or household_id in (select public.my_household_ids())
    or exists (select 1 from public.people p
               where p.id = person_id
                 and p.household_id in (select public.my_household_ids()))
  );

-- A family may record their own signature, and may self-report having
-- completed an outside provider's waiver. Only staff may assert that it
-- was confirmed against the provider's list or received on paper —
-- those are claims about what the ministry checked, not about what the
-- family did.
create policy agreement_signatures_insert on public.agreement_signatures
  for insert to authenticated
  with check (
    public.is_staff()
    or (status in ('self_reported', 'signed_here')
        and (household_id in (select public.my_household_ids())
             or exists (select 1 from public.people p
                        where p.id = person_id
                          and p.household_id in (select public.my_household_ids()))))
  );

create policy agreement_signatures_update on public.agreement_signatures
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- --- money ------------------------------------------------------------
--
-- The coupons table is staff-only for reading as well as writing. A
-- family able to SELECT it could read every code the ministry has
-- issued, including single-use hardship codes meant for someone else.
-- Redemption happens server-side; the family never queries this table.

-- The catalogue side of money. Families need to see a schedule they
-- are being offered and a discount that has been applied to them, so
-- these are readable; only staff may define them.
create policy transaction_categories_select on public.transaction_categories
  for select to authenticated using (public.is_staff());

create policy transaction_categories_write on public.transaction_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy discount_rules_select on public.discount_rules
  for select to authenticated using (true);

create policy discount_rules_write on public.discount_rules
  for all to authenticated using (public.is_registrar()) with check (public.is_registrar());

create policy payment_schedules_select on public.payment_schedules
  for select to authenticated using (true);

create policy payment_schedules_write on public.payment_schedules
  for all to authenticated using (public.is_registrar()) with check (public.is_registrar());

create policy coupons_staff on public.coupons
  for all to authenticated
  using (public.is_registrar()) with check (public.is_registrar());

create policy coupon_redemptions_select on public.coupon_redemptions
  for select to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_staff());

create policy coupon_redemptions_write on public.coupon_redemptions
  for all to authenticated
  using (public.is_registrar()) with check (public.is_registrar());

create policy scholarships_select on public.scholarships
  for select to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_staff());

create policy scholarships_insert on public.scholarships
  for insert to authenticated
  with check (registration_participant_id in (select public.my_participant_ids()));

-- A family may withdraw a request or edit their statement; granting is
-- a staff act.
create policy scholarships_update on public.scholarships
  for update to authenticated
  using (registration_participant_id in (select public.my_participant_ids())
         or public.is_registrar())
  with check (
    public.is_registrar()
    or (registration_participant_id in (select public.my_participant_ids())
        and status in ('requested', 'withdrawn')
        and granted_cents = 0)
  );

create policy payment_plans_select on public.payment_plans
  for select to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_staff());

create policy payment_plans_write on public.payment_plans
  for all to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_registrar())
  with check (registration_id in (select public.my_registration_ids()) or public.is_registrar());

create policy payment_installments_select on public.payment_installments
  for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.payment_plans pp
               where pp.id = payment_plan_id
                 and pp.registration_id in (select public.my_registration_ids()))
  );

create policy payment_installments_write on public.payment_installments
  for all to authenticated
  using (public.is_registrar()) with check (public.is_registrar());

create policy payments_select on public.payments
  for select to authenticated
  using (registration_id in (select public.my_registration_ids()) or public.is_staff());

-- Card and bank payments are written by the Stripe webhook using the
-- service key, which bypasses these policies entirely. What is allowed
-- here is a registrar recording a cheque or cash that arrived in the
-- post. A family cannot mark their own registration paid.
create policy payments_manual_insert on public.payments
  for insert to authenticated
  with check (public.is_registrar() and method in ('check', 'cash', 'other'));

create policy payments_manual_update on public.payments
  for update to authenticated
  using (public.is_registrar() and method in ('check', 'cash', 'other'))
  with check (public.is_registrar() and method in ('check', 'cash', 'other'));


-- --- messages ---------------------------------------------------------
--
-- Staff only. The log holds email addresses across every household.

create policy message_log_staff on public.message_log
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());


-- ---------------------------------------------------------------------
-- 19. Self-check
--
-- Raises if any table in public has RLS off, or has RLS on with no
-- policy at all. Both are silent in normal use; this makes them loud
-- at migration time.
-- ---------------------------------------------------------------------

do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ')
    into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if bad is not null then
    raise exception 'Tables in public with row-level security disabled: %', bad;
  end if;

  select string_agg(c.relname, ', ')
    into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if bad is not null then
    raise exception 'Tables with row-level security enabled but no policy: %', bad;
  end if;

  -- A view without security_invoker is a hole straight through RLS.
  select string_agg(c.relname, ', ')
    into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not coalesce((c.reloptions::text like '%security_invoker=true%'), false);
  if bad is not null then
    raise exception 'Views without security_invoker: %', bad;
  end if;

  raise notice 'Migration 0001 self-check passed.';
end;
$$;
