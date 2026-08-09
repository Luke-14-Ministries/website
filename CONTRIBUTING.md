# Contributing

This is the Luke 14 Ministries website. It is maintained by ministry volunteers, so
this guide assumes no prior knowledge of this project and not much of Next.js.

If you are entirely new, read sections 1 through 3 and stop. The rest is reference.

The wider project documentation — plans, vendor decisions, brand assets, board
materials — lives in the ministry's SharePoint team site under **Website**, not in
this repository. Its `README.md` is the companion to this file and covers the
non-code half of the job.

---

## 1. What this is

A **Next.js** application, hosted on **Vercel**. Deployment is automatic: Vercel
watches the `main` branch, every push triggers a build, and a successful build is live
within a minute or two. Nothing is ever uploaded by hand.

The preview serves at <https://luke14-ministries.vercel.app>. The ministry's own
domain, `luke14ministries.net`, still points at the ministry's existing Squarespace site and will keep
doing so until the board approves the switch.

**If you find a note anywhere describing this site as a "static export," it predates
5 August 2026.** Until then the site was compiled to plain HTML files and published by
GitHub Pages. The difference is not cosmetic: a static export has no server behind it,
so it cannot reach a database or take a payment. Family sign-up, saved registrations
and Stripe all need server code, so `output: 'export'` came out of `next.config.mjs`
and GitHub Pages was retired the same day.

Registration, payments and camper data are being built on Supabase and Stripe now.

---

## 2. Getting set up

### Access

Ask a GitHub organization Owner to add you to **luke-14-ministries**. Use your own
GitHub account — GitHub's terms are one account per person and the ministry keeps no
shared login. Two-factor authentication is required by the organization.

### Tools

| Tool | Version | Notes |
|---|---|---|
| [Git](https://git-scm.com/downloads) | any current | Accept the installer defaults |
| [Node.js](https://nodejs.org/) | **24 LTS** | Take LTS, not "Current." Node 20 reached end of life on 30 April 2026 |
| [VS Code](https://code.visualstudio.com/) | any | Optional, but assumed below |

Reopen your terminal after installing Node, then check:

```bash
node --version    # v24.x
npm --version
git --version
```

If `npm` is "not recognized," the terminal predates the installer finishing its PATH
update. Reopening it is the whole fix.

### Clone and run

Clone to a local disk path, **never inside OneDrive or SharePoint** — file-sync
clients corrupt the hidden `.git` directory, usually silently. `C:\dev\luke14` is the
convention here.

```bash
mkdir C:\dev
cd C:\dev
git clone https://github.com/luke-14-ministries/website.git luke14
cd luke14
npm ci
npm run dev
```

Open <http://localhost:3000>. The site reloads as you save. `Ctrl+C` stops it.

Use **`npm ci`**, not `npm install`, whenever you are setting up or syncing — it
installs exactly the versions in `package-lock.json`, which are the versions the
project was tested with. `npm install` is for deliberately changing a dependency, and
it rewrites the lockfile as a side effect.

---

## 3. Making a change

```bash
git pull                     # take everyone else's work first
                             # ... edit, watch localhost:3000 ...
npm run build                # prove the production build still succeeds
git add .
git commit -m "Update Camp Celebrate dates for 2027"
git push
```

The push deploys. Vercel reports each build back to GitHub, so the quickest check is
the small mark beside your commit on the repository's front page: a green check means
it is live, a red X means the build failed and the previous version is still serving —
which is the system working as intended. The Vercel dashboard shows the build log when
you need to know *why* it failed.

Write commit messages in plain language describing what changed and why. In six months
that sentence is the only explanation anyone will have.

**For anything larger than a typo, use a branch and a pull request** so a second person
sees the change before the public does:

```bash
git checkout -b camp-dates-2027
                             # ... commit as usual ...
git push -u origin camp-dates-2027
```

Then open the pull request on GitHub and request a review.

---

## 4. Project layout

```
app/                    One folder per route. app/donate/page.jsx is /donate.
  layout.jsx            Wraps every page — header, footer, preview banner.
components/             Shared UI pieces reused across pages.
public/                 Served verbatim. public/images/logo.png is /images/logo.png.
lib/                    Shared helper code.
next.config.mjs         Build configuration. Rarely needs touching.
tailwind.config.js      Design tokens — colors, fonts, spacing scale.
.gitattributes          Line-ending normalization. Do not remove.
```

Styling is [Tailwind CSS](https://tailwindcss.com/): utility classes applied directly
in the markup rather than a separate stylesheet. Change shared colors and fonts in
`tailwind.config.js` so they stay consistent everywhere.

### Adding a page

Create `app/<route>/page.jsx` exporting a default React component. The folder name is
the URL. Add the link to the navigation in `components/` so people can find it.

### Adding an image

Put it in `public/images/` and reference it as `/images/<name>`. Resize and compress
first — full-width banners no wider than 1600px, inline images no wider than 800px,
JPEGs under roughly 300 KB. Prefer `.webp` where your tool offers it. Name files in
lowercase with hyphens: `summer-camp-2026-worship.jpg`, not `IMG_4471.JPG`.
Unoptimized photographs are the most common cause of a slow site.

**Photographs of campers require documented consent on file before publication.** When
in doubt, do not publish. This applies to group shots as well as portraits.

---

## 5. Security rules

These are not negotiable, and none of them are hypothetical.

**No secrets in this repository, ever.** No API keys, no database credentials, no
Stripe keys. `.env.local` is in `.gitignore` for this reason; `.env.example` is the
committed template that documents which variables exist without their values. Real
values live in the password vault and, for the running site, in the hosting provider's
environment-variable settings. A Stripe key committed here is a live payment
credential visible to the entire internet, and rotating it does not un-publish it —
git keeps history forever.

**No camper data in this repository.** No names, no medical information, no
background-check paperwork. When registration is built, the application will store a
yes/no "background check on file" flag and a date; the documents themselves stay in the
ministry's restricted-access folder.

**Development uses Stripe test keys only.** Live keys appear at launch, under the
ministry's own account, and never on a developer's machine.

**Two-factor authentication on every account this project touches** — GitHub, and later
Vercel, Supabase, Stripe and Microsoft 365.

---

## 6. Things that will bite you

**`npm audit fix --force` will break this project.** Plain `npm audit fix` is safe.
The `--force` variant may install *older* major versions to satisfy an advisory; it has
already once downgraded Next.js here by six major releases, silently. If you have run
it, `git restore .` before committing anything, then `npm ci`.

**Most `npm audit` findings do not apply here.** They nearly always concern build
tooling that runs on a developer's machine rather than code served to a visitor. Read
the advisory before acting on it — and note this rule is weaker than it used to be:
while the site was a static export it shipped no server code at all, so nothing in an
advisory could reach a visitor. From Phase 1 onward it does run server code, so an
advisory touching something that runs at request time deserves a real look.

**Deprecation warnings during install are noise.** A package author renamed something.
Not an error, nothing to do.

**Never edit anything inside `node_modules`.** It is a disposable cache. When things
get strange, delete it and run `npm ci`.

**Line endings.** `.gitattributes` normalizes everything to LF in the repository. If
git ever reports hundreds of changed files you did not touch, that is a line-ending
mismatch, not work: `git diff --ignore-cr-at-eol --stat` shows what actually changed.

**Your browser caches hard.** Vercel serves the new build the moment it finishes, but
your browser may not ask for it. After a deploy, use `Ctrl+F5` or a private window
before concluding a change did not land.

**The preview banner is deliberate.** `components/PreviewBanner.jsx` marks every page
as a test build so camp administrators are not confused by it. It comes out of
`app/layout.jsx` only when the board approves going live on the ministry's domain.

---

## 7. Glossary

**Repository (repo)** — this folder of source code, plus its complete history.
**Clone** — your local copy of it.
**Commit** — a saved, described snapshot of your changes.
**Push / pull** — send your commits to GitHub / bring down everyone else's.
**Branch** — a parallel line of work that does not affect the live site until merged.
**Pull request (PR)** — a proposal to merge a branch, with room for review first.
**Static export** — compiling a site to plain files with no server behind them. This
site was built that way until August 2026. It is not any more.
**Vercel** — the company that hosts the site and rebuilds it on every push to `main`.
**Environment variable** — a setting supplied by the host at run time, so that keys
never enter the code.

---

*Found something here that is out of date? Fix it and open a pull request. This file is
meant to be edited.*
