# CLAUDE.md — Luke 14 Ministries website & registration platform

Read this before touching anything. It is the standing brief for any Claude session working in
this repository, and it outranks assumptions carried in from other Next.js projects.

---

## What this project is

Luke 14 Ministries is a disability ministry in Morristown, Tennessee — a registered 501(c)(3).
This repository is the ministry's public website **and**, from Phase 1 onward, its own camp
registration platform.

The reason the platform is being built rather than bought: Campsite costs the ministry roughly
**7.4% all-in** — a 6% transaction rate *plus* a flat platform fee of about $249/month, and on the
ministry's volume the fixed half is the larger half. Replacing that is the entire financial case.
The 6%-only figure quoted in older documents is retired; see `DECISIONS.md`, 2026-08-05. Vendors are
used only where they carry real risk we should not: payments (Stripe), database and auth
(Supabase), hosting (Vercel), DNS and edge protection (Cloudflare), identity and documents
(Microsoft 365).

Two constraints shape every decision:

1. **A volunteer built this, and a volunteer has to be able to maintain it.** Prefer the boring,
   well-documented option over the clever one. Explain *why* in comments and in `DECISIONS.md`.
2. **It must be live before next camp season's registration opens**, and the maintainer's
   availability drops sharply once the academic semester starts. Front-load. Do not start
   architectural rewrites in October.

The full reasoning lives in `IMPLEMENTATION-PLAN.md` (SharePoint, `01 Plans and Decisions\md files`).
The working checklist is `DO-THIS-NEXT.md` (SharePoint, `02 Accounts and Setup\md files`).

---

## Where things stand — 30 August 2026

**The database is live.** Migration `0001_core_schema.sql` has been run against the Supabase
project `luke14-prod` (ref `nnbcxqxwkivadzognpno`). Queried directly on 30 August 2026 rather
than remembered, the live schema holds **47 base tables, 5 views and 108 row-level-security
policies**, with **RLS enabled on all 47 of the 47 tables** and 40 functions in `public`.
Self-check passed.
`supabase/migrations/rls_test.sql` is the harness — it seeds **six personas** (two families, three
staff at different access levels, and the camp doctor) plus an unauthenticated visitor, runs **41
assertions** against them and reports `ALL CHECKS PASSED` against real Postgres. **Never edit 0001; it has been run.** New work
goes in `0002_*.sql`.

**Authentication works end to end**, proven against the live database: sign-up → confirmation email
→ callback → session → dashboard rendering the person's own name out of `public.profiles`, with
`handle_new_user()` creating that row automatically. Login, logout and password reset are wired.

**Known limitation, now fixable.** Confirmation links use PKCE (`?code=`), so opening one in a
*different browser* from the one that signed up fails — the code verifier lives in the original
browser. The account is still confirmed (Supabase verifies server-side before redirecting), so the
recovery is simply to log in, which is why `/account/link-expired` leads with a Log In button. The
real fix is switching the Supabase email templates to `token_hash` — `app/auth/callback/route.js`
already handles both shapes — and the old blocker is gone: **custom SMTP is set up** (auth email
sends through Resend from `registration@luke14ministries.net`), so template edits are now allowed. Making
that template switch is an open, unblocked task.

**Update, 26 August 2026 — the platform is built and in staff testing.** Migrations now run
through `0061` (never edit a migration that has been run; new work goes in the next number).
Checked on 30 August against the live ledger: the repository and production agree, with no
applied migration missing from `supabase/migrations/`. Two caveats about that ledger, so nobody
reads drift into it. It begins at `0012` — `0001`–`0011` were applied before the CLI ledger was
in use. And four repository files were applied as more than one entry each (`0023`, `0028`,
`0032`, and `0059`, whose second half is recorded as `all_screening_verdicts`), so the ledger
carries 54 rows for 50 files. Both are expected; neither is a missing migration. Working end
to end in Stripe test mode: family accounts and household management (per-adult phones, linked
caregivers), the registration wizard with true edit/update mode and tracked changes (staff review
queue at /admin/changes; role changes on a confirmed person auto-flip to re-review), card + bank
payments with receipts from camp@, scholarships/discounts with a credit display ("Credit −$X"),
printable statements (staff at /admin/registrations/[id]/statement, family at
/account/statement/[id], donors at /admin/giving/statements — all on ministry letterhead), the
staff admin (rosters, check-in, dietary + no-names kitchen list, medical, Event Payments with a
90-day event scope + filtered CSVs, Giving, Staff & Access), and Resend newsletters (trial sent;
click-tracking domain verified).

**Working rules learned the hard way:** every new table needs explicit role grants alongside its
RLS policies (RLS without `grant ... to authenticated` = permission denied); never swallow query
errors in admin pages; `/account/*` "my data" queries must scope by household membership
explicitly, never rely on RLS alone (staff RLS is broad); PostgREST nested joins with two FKs to
the same table are fragile — use separate simple lookups.

**Done since that update:** the volunteer application (17 Aug); Turnstile on the public account
forms (live on sign-up, login and password reset); and refunds end to end — `charge.refunded`
handled by `supabase/functions/stripe-refund-webhook/`, per-family refunds through `refundPayment`
in `app/admin/registrations/[id]/actions.js`, with the over-refund guard and the pending-refund
accounting in migrations `0038`/`0044`/`0053`/`0054`.

**Built since, 27–29 August — six migrations the paragraph above predates.** Background screening
stopped being a placeholder (`0056`–`0060`): `person_clearances`, screening batches, background
checks as their own staff permission with every grant recorded in an audit log, the result detail
learned from a real Checkr export, and a translation layer between Checkr's vocabulary and ours.
Then `0061`, which is the one to read before touching access control — see the next section.

**Next, in order:**

1. **Purge ALL test data** from the production project. Everything after this depends on it.
2. **Live Stripe keys**, and **both** live-mode webhooks — `stripe-webhook` *and*
   `stripe-refund-webhook`. Test-mode endpoints do not carry over; a missed refund webhook fails
   silently (see migration `0054`).
3. **Vercel Pro.** Required the moment live keys are in — Hobby is non-commercial only. See the
   Hosting note below.
4. **Spam protection on the contact and newsletter forms.** Turnstile covers the account forms
   only; these two are still open.
5. **The balance-reminder buttons in `app/admin/payments/page.jsx`** are still `disabled`
   placeholders — "Email balance reminders (all shown)" and "Email selected families" render but
   do nothing.

### Program leaders are not staff — a second kind of person now reaches `/admin`

Added 29 August in migration `0061`, and easy to miss: a **program leader** has **no row in
`staff`**, no role, and none of the permissions in `lib/staff.js`. Reading that file alone would
tell you they do not exist. What they have is a grant in `program_leaders` naming one program at
one event, and the only thing it buys is the right to read the `program_roster` **view**, filtered
to that program.

Three things follow, and all three are deliberate:

- **The view is the permission.** `program_roster` carries names, ages, a buddy, and *flags* for
  allergies and support needs — never the narrative columns. `0061` deliberately adds **no** policy
  to `registration_participants`, `people` or `person_support`: an earlier draft did, and it was
  removed, because a leader who can select the participant row can select every column on it.
- **`program_roster` is a `SECURITY DEFINER` view, and that is intended.** It has to be, since a
  leader holds no read on the tables underneath. It is safe because the view's own
  `where public.is_staff() or public.leads_program(...)` is the row filter. Supabase's advisor
  reports this as its one ERROR-level finding; the entry accepting it is in `DECISIONS.md`,
  30 August. Do not "fix" it by switching it to `SECURITY INVOKER` — that silently empties every
  leader's roster.
- **Leaders are held to the two-factor rule too**, in `app/admin/layout.jsx`. That is a decision,
  not an oversight: what they see is a list of disabled children's first names.

**Still mock:** the contact form discards submissions, and the newsletter page links out to a
Google Form.

---

## Stack

Next.js (App Router, JavaScript — not TypeScript), Tailwind CSS, deployed on Vercel.
Supabase (Postgres + Auth) from Phase 1. Stripe from Phase 2.

`app/` holds routes, `components/` shared UI, `lib/` helpers, `public/` static assets.

---

## Blocking facts — read these before writing code

### `output: 'export'` is gone — do not put it back (done 5 August 2026)

`next.config.mjs` now carries `trailingSlash: true` and nothing else. `output: 'export'`,
`basePath` and `images: { unoptimized: true }` were removed together in commit `eaef8d5`, the
opening commit of the Phase 1 sprint.

`output: 'export'` compiles the site to flat HTML and disables **all** server code — no API
routes, no server actions, no database calls, no Stripe. It blocked every item in Phase 1. The
other two were GitHub Pages accommodations: `basePath` served the site from a subfolder, and a
static export cannot run Next's image optimiser.

`trailingSlash: true` **stays.** It is a URL preference, not a hosting accommodation — removing
it turns `/about/` into `/about` across every link in the site.

Anything in older documentation calling this site a "static export" is out of date.

### GitHub Pages is retired — do not revive it (done 5 August 2026)

Hosting is Vercel, and only Vercel. On 5 August, in order: Pages was unpublished in repository
Settings, `.github/workflows/deploy.yml` was deleted (commit `8ea87ce`), the leftover
`github-pages` environment was removed, and the repository was renamed from
`luke-14-ministries.github.io` to **`website`**. That old name was not decorative — a repository
named `<org>.github.io` is what *tells* GitHub to serve it as the organization's Pages site.

The `Production` environment that remains under Settings → Environments belongs to **Vercel**,
which creates it through the deployments API. Leave it alone.

**`.github/workflows/build.yml` exists again from 30 August 2026, and it is NOT a deploy
workflow.** It runs `npm ci`, `npm run lint` and `npm run build` on every push to `main`, and
publishes nothing anywhere. Vercel still does all deploying, through its GitHub integration and
not through any file in this repository. The distinction matters because the last workflow file
here *was* a Pages deployer, so a future reader finding `.github/workflows/` again could
reasonably assume Pages had crept back. It has not. If that file ever grows a step that uploads,
publishes or deploys, something has gone wrong.

The repository is `https://github.com/luke-14-ministries/website.git`. GitHub redirects the old
URL, so an out-of-date clone still works, but new instructions should use the new name.

`lib/site.js` still exports an `asset()` helper that prefixes paths with
`NEXT_PUBLIC_BASE_PATH`. That variable is unset on Vercel, so it returns paths unchanged; it is
used in 16 files and was deliberately left in place rather than risk a typo across all of them
for no functional gain. Known dead weight, not a bug to fix urgently.

### `NEXT_PUBLIC_BASE_PATH` must stay **unset** on Vercel

It exists so a site can be served from a subfolder, which GitHub Pages needed and Vercel does
not. Setting it on Vercel breaks every
link and every image, and it fails in a way that looks like a CSS problem rather than a config
problem — which is how it eats an afternoon. Leave it out of the Vercel environment variables
entirely.

### The site is deliberately hidden from search engines — do not "fix" this

**Four** switches, all intentional while this is a preview:

- `public/robots.txt` — `Disallow: /`
- `app/layout.jsx` — `robots: { index: false, follow: false }`
- `app/layout.jsx` — the title suffix `"(Preview Build)"`
- `components/PreviewBanner.jsx` — the red PREVIEW banner

**All four are reversed together in Phase 4, at launch, and only with board approval.** Reversing
any of them early publishes a mock-up as if it were the real site. Forgetting one at launch fails
*silently* — the site simply never appears in search results and nobody notices for months. Treat
it as a single four-part checklist item.

---

### What is actually in DNS today *(verified 7 August 2026)*

Queried directly rather than assumed. `luke14ministries.net`:

- **Nameservers** are `ns01`–`ns04.squarespacedns.com` (running on NS1). The public site's A records
  are Squarespace's. **The existing site is Squarespace, not WordPress** — several older documents
  say otherwise and are wrong.
- **The registrar is therefore almost certainly Squarespace.** Nameservers prove who runs DNS rather
  than who holds the registration, so confirm it inside the Squarespace account before relying on it.
- **Mail is Microsoft 365** — MX points at `luke14ministries-net.mail.protection.outlook.com`, and a
  `MS=` verification token is present.
- **SPF is `v=spf1 include:spf.protection.outlook.com -all`.** Note the `-all`: that is a *hard*
  fail, so any sender not listed is rejected outright. Adding a new sender (Resend) means editing
  this exact line, and an error here silently breaks every staff email the ministry sends. Change it
  carefully, with someone watching, and never as the last task of a session.
- **DMARC exists but does nothing**: `v=DMARC1; p=none`, with no `rua=` reporting address, so nobody
  is being told who sends as the ministry.
- **No Mailchimp, no other bulk sender is authorised on this domain.** The newsletter is therefore
  going out either through Squarespace's own campaigns or from a vendor's from-address.

---

## Security rules — non-negotiable

These are the ministry's rules, agreed at board level. Do not relax them for convenience.

- **No secret ever enters this repository, OneDrive, or SharePoint.** Not in a commit, not in a
  comment, not "temporarily." Keys live in Vercel's environment variables plus the shared
  password vault. `.env.local` is gitignored; `.env.example` is the committed template and
  contains names only, never values.
- **Test keys only until launch.** Fake money, throwaway data. Live Stripe keys appear once, at
  go-live, and only in Vercel's environment settings.
- **The Supabase `service_role` / secret key bypasses row-level security entirely.** It never
  goes in the browser, in this repository, in SharePoint, or in a chat transcript. Server-side
  only, from an environment variable, and only where genuinely required.
- **Row-level security is enforced at the database level**, not in application code. Every table
  holding family data gets RLS policies. A query that works because the app "wouldn't ask for
  that row" is not secured.
- **No real family data in the preview.** It is a mock-up, and mock-ups leak.
- **No Social Security number, and no report content, ever enters this system.** That is the
  principle, and it holds. What is actually stored has grown: alongside
  `background_check_on_file`, `background_check_date` and `expires_on`, migration `0029` added a
  `volunteer_clearances` table with Checkr integration columns — `provider`,
  `checkr_candidate_id`, `checkr_invitation_id`, `checkr_report_id`, `checkr_package`,
  `checkr_status`, `adjudication`, `invitation_sent_at`, `report_completed_at`, `last_synced_at`.
  These are identifiers, a status and timestamps: pointers into Checkr, never the screening data
  itself. Checkr's **hosted invitation** flow is what keeps it that way — the volunteer types
  their SSN and date of birth into Checkr's own form, and we receive only pass/fail. It cannot
  leak from us because we never have it. **`0029` was a placeholder and no longer is** — corrected
  30 August, having said "nothing writes them yet" for four days after it stopped being true.
  `0056`–`0060` built the flow out and `app/admin/volunteers/screening/actions.js` writes
  `person_clearances` today: `provider`, `checkr_status`, `checkr_report_id`,
  `checkr_candidate_id`, `checkr_package`, and a `screening_results` jsonb holding one verdict
  WORD per screening. The guarantee is unchanged and is the reason the file-based flow was chosen
  over the API — verdict words and pointers, never report content, and no SSN at any point. The
  underlying paperwork still lives in a
  permission-restricted SharePoint folder. Never in email, never in the app. A future flow that
  would collect PII into this table is a board decision, not a pull request.
- **Never paste a key, token, or camper's personal information into a Claude conversation.** A
  secret that appears in a transcript is compromised and must be rotated.
- **Two-factor authentication on every account** — GitHub, Vercel, Supabase, Stripe, Microsoft.
  Prefer authenticator-app (TOTP) over passkeys on shared ministry accounts: a passkey is bound
  to one device and cannot be shared between two admins; a TOTP seed can live in the vault.

---

## Working rules

- **Never let OneDrive or SharePoint sync this repository.** It corrupts `.git`. The working copy
  lives at `C:\dev\luke14` for exactly this reason. Documents go to SharePoint; code does not.
- **Ownership is the ministry's, not a person's.** Production accounts are created under
  `admin@luke14ministries.net`. Never bind a ministry account to a personal GitHub login, and
  never add `admin@` as a verified email on a personal GitHub account.
- **Do not point the domain.** `luke14ministries.net` serves the ministry's existing **Squarespace**
  site. Pointing it retires that site, which is a board decision, not a technical step. Phase 4.
  (Older documents call this a WordPress site. That was wrong — see the DNS facts below.)
- **Record decisions in `DECISIONS.md`** — one short entry per real choice, written when the
  choice is made. In six months it is the only record of why anything is the way it is.
- **Check this file's numbers before trusting them, and correct them when they are wrong.**
  It has now drifted twice: eight ways over nineteen days to 26 August, then four more ways in
  the four days after it was corrected. The pattern is specific and worth naming — the documents
  that are *regenerated* show no drift at all, and the one that is *edited by hand* drifts every
  time. Two commands settle most of it in ten seconds, and a session that is about to rely on a
  number here should run them rather than quote the paragraph:

  ```bash
  ls supabase/migrations | tail -2      # the real high-water mark
  git log -1 --date=short --format=%ad  # how old "where things stand" actually is
  ```

  A claim about what is *built* is the one that cannot be checked this way and goes stale
  hardest — "nothing writes them yet" was true when written and false four days later. When you
  find one wrong, fix it in the same session; leaving it is how the next reader inherits it as
  fact.
- **Commit in small, described steps.** The commit log is documentation for a future volunteer.
- **Ask before adding a dependency.** Every package is something someone has to keep updated.
- Commit identity is the ministry account, not a personal address. Check `git config user.email`
  if commits start showing up attributed oddly.

---

## Phase roadmap (short form)

- **Phase 0 — now.** Accounts, ownership, vault, register, governance. Mostly not code.
- **Phase 1 — August sprint. Complete.** Removing `output: 'export'` (5 August), the Supabase
  schema with RLS, family sign-up and login, the registration wizard writing to real storage, and
  Stripe end to end in **test mode** with fake money — all shipped. See "Where things stand"
  above, which is the authoritative account.
- **Phase 2. Complete, and well past the original scope.** Rosters, payment status and the
  background-check flag were the ask. Delivered instead: the full staff admin (rosters, check-in,
  dietary and kitchen lists, medical, Event Payments with filtered CSVs, Giving, Staff & Access),
  the change-review queue, scholarships and discounts, printable statements on letterhead,
  refunds, cancellation requests, lodging assignments, activities with capacity guards, the
  volunteer application, and Resend newsletters.
- **Phase 3.** Review by real people on the preview URL. Still test keys, still no real families.
- **Phase 4 — launch.** Vercel Pro, live Stripe keys, domain pointed, and all four preview
  switches reversed together. Board approval gates this phase.

Sections 5 and 9 of `IMPLEMENTATION-PLAN.md` describe Phase 1 in full.

---

## Hosting note

Vercel's free **Hobby** plan is the right plan for building, and it is legitimate for Phases 1–3.
It is **not** legitimate at launch: Hobby is non-commercial only, and Vercel's fair-use terms
count "any method of requesting or processing payment from visitors of the site," adding
explicitly that asking for donations counts too. Being a 501(c)(3) does not change it — the test
is what the site *does*. Hobby is also a single seat, which conflicts with the two-admins-on-
everything rule. **Pro ($20/developer seat/month, viewer seats free) becomes necessary the moment
Stripe switches to live keys.** Plan §8 has the full reasoning.

---

## Where the documentation lives

- `IMPLEMENTATION-PLAN.md` — why, and the full phase plan. SharePoint, `01 Plans and Decisions\md files`.
- `DO-THIS-NEXT.md` — the ordered working checklist. SharePoint, `02 Accounts and Setup\md files`.
- `Luke14-Account-Register.xlsx` — every account, who owns it, who the second admin is. No
  passwords, ever. SharePoint, `02 Accounts and Setup`.
- Web-admin handbook — SharePoint, for the second admin.
- `CONTRIBUTING.md` — repository conventions.
- `DECISIONS.md` — the running decision log.

---

*Last updated 30 August 2026 — schema at 47 tables / 5 views / 108 policies (queried, not
remembered), migrations through `0061`, background screening built out, program leaders added as
a non-staff role.
26 August 2026 — refunds live, Phases 1 and 2 complete.
9 August 2026 — schema run, auth layer working.
7 August 2026 — DNS verified (Squarespace, not WordPress).
5 August 2026 — GitHub Pages retired, repository renamed to `website`,
static-export config removed.*
