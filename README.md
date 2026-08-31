# Luke 14 Ministries — Website Rebuild (Preview)

A recreation of [luke14ministries.net](https://luke14ministries.net) plus mockups of the new
accounts platform (Camp Celebrate registration for families & volunteers, and online giving).
Every page shows a red **PREVIEW / TEST BUILD** banner so camp administrators know it is not
the official site.

**Live preview:** <https://luke14-ministries.vercel.app>

## Run locally

```bash
npm ci             # installs the exact tested versions; use this, not npm install
npm run dev        # http://localhost:3000
```

Requires **Node.js 24 LTS** — the same major version Vercel builds with, which is deliberate:
matching it locally is what stops "it built on my machine" from being a different answer to
"it built on Vercel."

**You also need `.env.local` before either command does anything useful.** This step was missing
from these instructions until 30 August 2026, and its absence does not fail gracefully: the site
compiles fine and then dies at the end of `npm run build` with
`@supabase/ssr: Your project's URL and API key are required`, naming a Supabase settings page
rather than the file you actually forgot. The fastest fix, which never puts a key on the
clipboard or in a chat window:

```bash
npx vercel login
npx vercel link          # pick the luke14-ministries project
npx vercel env pull .env.local
```

Failing that, copy `.env.example` to `.env.local` and fill in the two `NEXT_PUBLIC_SUPABASE_*`
values from the Supabase dashboard. Those two are safe in a browser by design — that is what the
prefix means — and they are all a local build needs. `.env.local` is gitignored; keep it that way.

New here? Read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers setup, the everyday git
workflow, project layout, and the security rules.

## How it deploys

**Vercel** watches `main` and rebuilds on every push. Nothing is uploaded by hand, and there
is no deploy workflow in this repository to maintain — Vercel's GitHub integration does the
watching.

There *is* one GitHub Action, added 30 August 2026: `.github/workflows/build.yml`. It lints and
builds on every push to `main` and deploys nothing — it exists so a broken build arrives as an
email in about three minutes rather than as a stale preview site somebody notices days later. It
needs no secrets.

`NEXT_PUBLIC_BASE_PATH` must stay **unset** on Vercel. It exists only so a site can be served
from a subfolder; setting it breaks every link and every image, and it fails in a way that
looks like a styling problem rather than a configuration one.

Until 5 August 2026 this repository was named `luke-14-ministries.github.io` and published to
GitHub Pages by `.github/workflows/deploy.yml`. Pages is unpublished, the workflow is deleted,
and `output: 'export'` is out of `next.config.mjs` — a static export cannot run server code,
which blocked every part of the registration platform.

## What's here

- **Recreated pages** — Home, Mission & Story, Leadership, Resources, Camp Celebrate (+ Camper
  Info, Volunteer Info, Camp Memories), Luke 14 Party, Wheels for Kenya, The Hazelnut Movement,
  Adult Adventure Retreat, Donate, Pray, Newsletter, Host a Speaker, Contact. Content captured
  verbatim from the live site (July 2026). All 126 photos are self-hosted in `public/images/`
  (downloaded at 2500px from the original site), so the site is fully standalone. Camp Memories
  embeds the original YouTube highlight videos per year; Luke 14 Party and Wheels for Kenya
  include their full photo galleries.
- **New platform mockups** (UI only, nothing saved/charged):
  - `/account` — login · `/account/signup` — account creation (family or volunteer path)
  - `/account/dashboard` — sample dashboard: registrations, household, giving history
  - `/register/family` — 4-step family registration wizard
  - `/register/volunteer` — volunteer application
  - `/donate` — original content + new online giving form (one-time/monthly, fund designation)

## Roadmap to the live platform

1. **Done — 5 August 2026.** Hosting moved to Vercel; `output: 'export'` removed, so server
   code is possible at all.
2. Gather admin feedback on the flows via the Vercel preview.
3. Backend: Supabase (auth + database) — real accounts, saved registrations, admin views,
   with row-level security enforced in the database rather than in application code.
4. Payments: Stripe (camp fees + donations, recurring giving, receipts). Test keys only until
   launch. The nonprofit discount does **not** apply to registration fees.
5. Before going public on the ministry's own domain, reverse all four preview switches
   together: `components/PreviewBanner.jsx` out of `app/layout.jsx`, `public/robots.txt`, the
   `robots: { index: false }` block in `app/layout.jsx`, and the "(Preview Build)" title
   suffix. Board approval gates this. Missing one fails silently — the site simply never
   appears in search results.

## Content notes (gaps found during capture)

- Video embeds (Luke 14 Party 2022 highlights, Wheels for Kenya 2024) and the Camp Memories
  photo galleries are client-rendered on Squarespace and couldn't be captured — placeholders used.
- The original contact form's fields didn't render in capture; a standard Name/Email/Subject/
  Message form is used.
- Pray/Newsletter/Kenya signups still link to the existing Google Forms; Hazelnut/speaker
  bookings still link to the existing Airtable forms (all functional).

## Project documentation

Plans, vendor decisions, account inventory, brand assets and board materials live in the
ministry's SharePoint team site under **Website** — not in this repository. Secrets live in the
password vault. Neither ever belongs in git.
