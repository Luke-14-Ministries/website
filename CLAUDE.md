# CLAUDE.md — Luke 14 Ministries website & registration platform

Read this before touching anything. It is the standing brief for any Claude session working in
this repository, and it outranks assumptions carried in from other Next.js projects.

---

## What this project is

Luke 14 Ministries is a disability ministry in Morristown, Tennessee — a registered 501(c)(3).
This repository is the ministry's public website **and**, from Phase 1 onward, its own camp
registration platform.

The reason the platform is being built rather than bought: the ministry currently pays
**Campsite 6% on every transaction**. Replacing that is the entire financial case. Vendors are
used only where they carry real risk we should not: payments (Stripe), database and auth
(Supabase), hosting (Vercel), DNS and edge protection (Cloudflare), identity and documents
(Microsoft 365).

Two constraints shape every decision:

1. **A volunteer built this, and a volunteer has to be able to maintain it.** Prefer the boring,
   well-documented option over the clever one. Explain *why* in comments and in `DECISIONS.md`.
2. **It must be live before next camp season's registration opens**, and the maintainer's
   availability drops sharply once the academic semester starts. Front-load. Do not start
   architectural rewrites in October.

The full reasoning lives in `IMPLEMENTATION-PLAN.md` (SharePoint, `01 Plans and Decisions`).
The working checklist is `DO-THIS-NEXT.md` (SharePoint, `02 Accounts and Setup`).

---

## Where things stand — 9 August 2026

**The database is live.** Migration `0001_core_schema.sql` has been run against the Supabase
project `luke14-prod` (ref `nnbcxqxwkivadzognpno`). 34 tables, 75 row-level-security policies,
self-check passed. `supabase/migrations/rls_test.sql` is the harness — it seeds seven personas and
reports `ALL CHECKS PASSED` against real Postgres. **Never edit 0001; it has been run.** New work
goes in `0002_*.sql`.

**Authentication works end to end**, proven against the live database: sign-up → confirmation email
→ callback → session → dashboard rendering the person's own name out of `public.profiles`, with
`handle_new_user()` creating that row automatically. Login, logout and password reset are wired.

**Known limitation, do not treat as a bug.** Confirmation links use PKCE (`?code=`), so opening one
in a *different browser* from the one that signed up fails — the code verifier lives in the original
browser. The account is still confirmed (Supabase verifies server-side before redirecting), so the
recovery is simply to log in, which is why `/account/link-expired` leads with a Log In button. The
real fix is switching the email template to `token_hash` — `app/auth/callback/route.js` already
handles both shapes — but **Supabase will not allow template edits until custom SMTP is set up**.

**That makes the registrar the critical path.** DNS is at Squarespace; the registration almost
certainly is too. Getting into that account unblocks: Resend domain verification → custom SMTP →
email templates → cross-browser confirmation links, plus a sender that says Luke 14 Ministries
instead of `noreply@mail.app.supabase.io`, and 30 messages an hour instead of 2.

**Next, in order:** commit and push what is on disk (three commits — docs, schema, auth); wire the
family registration flow to `registrations` / `registration_participants`; then Stripe in test mode.
`DATA-MODEL.md` in SharePoint explains the schema in prose and is the place to start.

**Still mock, despite looking real:** the contact form discards submissions, and everything below
the amber banner on the dashboard is placeholder.

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
- **Background-check paperwork never touches this system.** The database stores a boolean and a
  date — `background_check_on_file`, `background_check_date`. The documents themselves live in a
  permission-restricted SharePoint folder. Never in email, never in the app.
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
- **Commit in small, described steps.** The commit log is documentation for a future volunteer.
- **Ask before adding a dependency.** Every package is something someone has to keep updated.
- Commit identity is the ministry account, not a personal address. Check `git config user.email`
  if commits start showing up attributed oddly.

---

## Phase roadmap (short form)

- **Phase 0 — now.** Accounts, ownership, vault, register, governance. Mostly not code.
- **Phase 1 — August sprint.** Removing `output: 'export'` is **done — 5 August 2026**. Still to
  do: stand up the Supabase schema with RLS; family sign-up and login; wire the existing
  registration form to real storage; Stripe in **test mode**, end to end, with fake money.
- **Phase 2.** Admin views for staff: rosters, payment status, the background-check flag.
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

- `IMPLEMENTATION-PLAN.md` — why, and the full phase plan. SharePoint, `01 Plans and Decisions`.
- `DO-THIS-NEXT.md` — the ordered working checklist. SharePoint, `02 Accounts and Setup`.
- `Luke14-Account-Register.xlsx` — every account, who owns it, who the second admin is. No
  passwords, ever. SharePoint, `02 Accounts and Setup`.
- Web-admin handbook — SharePoint, for the second admin.
- `CONTRIBUTING.md` — repository conventions.
- `DECISIONS.md` — the running decision log.

---

*Last updated 9 August 2026 — schema run, auth layer working.
7 August 2026 — DNS verified (Squarespace, not WordPress).
5 August 2026 — GitHub Pages retired, repository renamed to `website`,
static-export config removed.*
