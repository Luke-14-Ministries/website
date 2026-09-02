# Decisions

One short entry per real choice, written when the choice is made. In six months this is the only
record of why anything is the way it is — including the things that look odd and are deliberate.

**How to use it.** Add new entries at the bottom, newest last. Each entry gets a date, a one-line
title, what was decided, and — the part that actually matters — *why*, and what the alternative was.
An entry that only records what was decided is half an entry: the next person needs to know whether
the reasoning still holds before they undo it.

Decisions that carry a real risk of being "fixed" by someone who does not know the reason are
marked **Do not reverse without reading this.**

The first several entries below were made between late July and 4 August 2026 and were written up
together on 4 August, which is why they share a date.

---

## 2026-08-04 — Build the registration platform rather than continue renting one

The ministry pays Campsite 6% on every transaction. On camp registration volume that is the single
largest avoidable cost in the operation, and it recurs every season forever. Building the platform
replaces that with Stripe's per-transaction rate — 2.9% + 30¢ on cards, or 0.8% capped at $5 by
bank transfer — plus roughly $45/month of hosting and database at launch. *(This entry originally
said 2.2% on Stripe's nonprofit rate. That was wrong; see the entry below dated the same day.)*

Vendors are still used, but only where they carry risk the ministry should not: payments (Stripe),
database and authentication (Supabase), hosting (Vercel), DNS and edge protection (Cloudflare),
identity and documents (Microsoft 365). The rule is that we do not hand-roll anything that would
make us liable for other people's money or other people's children's data.

*Alternative considered:* staying on Campsite. Cheaper in effort, and it stays cheaper right up
until you multiply 6% by the number of seasons remaining.

---

## 2026-08-04 — Production accounts are created under `admin@luke14ministries.net`

`admin@` is a Microsoft 365 distribution group forwarding to `lawrence@` and `larry@`. It has no
mailbox, no password, and no shared login. Every vendor account — Vercel, Supabase, Cloudflare,
Stripe — is registered to it.

The reason is ownership. An account created under a personal address belongs to that person, and
recovering it later means asking that person, who may by then have left, changed email, or lost the
phone. With `admin@`, a password-reset email arrives in both admins' inboxes and either one can
complete a recovery without the other.

The corollary is that a reset email nobody requested is an alarm rather than spam, and that
two-factor on `lawrence@` and `larry@` themselves matters as much as two-factor on the vendors —
either mailbox is enough to take over any vendor account.

**Never sign up with "Sign in with GitHub."** Vercel and Supabase both offer it and it is the faster
path, but it quietly binds the account to a personal GitHub login, which is the exact problem this
address exists to solve.

---

## 2026-08-04 — Two-factor uses authenticator apps (TOTP), not passkeys, on shared accounts

A passkey is bound to one device and cannot be shared between two admins. A TOTP seed can live in
the shared vault, where both admins can generate codes from it. On accounts the ministry owns
jointly, that difference decides it.

This is also why setting up the password vault is a genuinely blocking task rather than a tidy-up
one: until it exists, each vendor's authenticator seed sits on exactly one phone, and the printed
recovery codes are the only way back in if that phone is lost. Save those codes at the moment each
account is created.

SMS two-factor is not an option here either — there is no phone number attached to `admin@` to
share. And email-code two-factor is actively wrong on these accounts, because the code would arrive
in the same inbox as the login link.

---

## 2026-08-04 — The site is hosted on Vercel; GitHub Pages is being retired

GitHub Pages serves static files only. Every item in Phase 1 — family sign-up, login, storing a
registration, taking a payment — needs server-side code, which Pages cannot run at all. Vercel runs
the same Next.js application with the server side intact, rebuilds on every push, and costs nothing
during development.

This leaves the repository with a Pages-shaped name, `luke-14-ministries.github.io`. That name is a
Pages *instruction* rather than a description: a repository named `<org>.github.io` is served at the
organization root, which is also the reason `basePath` exists in the Next config. The repository
will be renamed to something ordinary once Pages is switched off, in that order — renaming it first
turns Pages off abruptly.

*Carried out on 5 August 2026 exactly in that order. See the entry of that date for what was done
and what was checked first.*

---

## 2026-08-04 — The preview URL is `luke14-ministries.vercel.app`, and it is public

**Do not reverse without reading this.**

There have been two preview addresses in circulation, which is confusing enough to be worth
recording. The Vercel production address is the one to share.

Vercel's deployment protection is switched on and its label — "all except custom domains" — reads as
though the production address is behind a login. It is not. Tested in a private browser window on
4 August 2026: `luke14-ministries.vercel.app` loads for anyone with the link. What deployment
protection actually gates is the *per-deployment* URLs, the long ones generated for each individual
build and each branch.

Two consequences follow. The board can be sent the production address directly. And during Phase 1,
a reviewer who is not a paid Vercel seat cannot open a branch preview at all — they can only see
what has been merged to `main`. On the free Hobby plan there is one seat, so that reviewer is
everyone except Lawrence. It resolves at launch, when Pro's viewer seats (free) become available.

The site stays out of search results because of the noindex switches, not because of any password.

---

## 2026-08-04 — The site is deliberately hidden from search engines until launch

**Do not reverse without reading this.**

Four switches, all intentional while this is a preview: `Disallow: /` in `public/robots.txt`;
`robots: { index: false, follow: false }` in `app/layout.jsx`; the `"(Preview Build)"` title suffix
in the same file; and the red banner in `components/PreviewBanner.jsx`.

They are one four-part checklist item, reversed together at launch in Phase 4, and only with board
approval. Reversing any of them early publishes a mock-up as if it were the finished site.
Forgetting one at launch fails *silently* — the site simply never appears in search results, and
nobody notices for months.

---

## 2026-08-04 — Vercel stays on the free Hobby plan until go-live, then moves to Pro

Hobby is the right plan for building and is legitimate for Phases 1 through 3. It is not legitimate
at launch: Vercel's fair-use terms restrict Hobby to non-commercial use and count "any method of
requesting or processing payment from visitors of the site," adding explicitly that asking for
donations counts too. Being a 501(c)(3) does not change it — the test is what the site *does*, not
what the organization is.

Hobby is also a single seat, which conflicts with the two-admins-on-everything rule.

The trigger for upgrading is therefore the moment live Stripe keys go in, not a date. Pro is $20 per
developer seat per month; viewer seats are free.

---

## 2026-08-04 — `NEXT_PUBLIC_BASE_PATH` stays unset on Vercel

**Do not reverse without reading this.**

The variable exists so GitHub Pages can serve the site from a subfolder. Setting it on Vercel breaks
every internal link and every image — and it fails in a way that looks like a broken stylesheet
rather than a configuration mistake, which is how it costs an afternoon. It is deliberately absent
from Vercel's environment variables rather than set to an empty string, so there is nothing there to
be "corrected" later.

---

## 2026-08-04 — The ministry's Cloudflare account is `Admin@luke14ministries.net's Account`

**Do not reverse without reading this.**

Cloudflare creates a personal default account for every user automatically at signup. So
`Lawrence@luke14ministries.net's Account` exists alongside the ministry's, was not created on
purpose, and cannot be tidily deleted. It is empty and should stay empty.

The risk is specific: "Add a site" drops the domain into whichever account happens to be selected.
If that is the personal one, the ministry's DNS ends up under a personal identity — exactly the
failure mode `admin@` exists to prevent, and unpleasant to unwind once nameservers point at it.

The rule: the ministry's zone, when it eventually exists, belongs to
`Admin@luke14ministries.net's Account`. The personal accounts are ignored.

Cloudflare's "Organizations" layer is a beta feature for companies managing many accounts. It adds
nothing here and is not used.

---

## 2026-08-04 — Both Cloudflare admins get Super Administrator, not a narrower role

Cloudflare's free plan offers a full catalogue of scoped roles, so least privilege was available and
was considered. It was rejected on purpose.

Least privilege protects against a compromised or careless *account*. The failure mode this project
actually faces is different: one of two admins being unreachable when something needs doing. A
narrower role does not reduce that risk, it increases it, because the remaining admin discovers the
gap at the worst possible moment. The audit-log benefit people usually want from scoped roles —
knowing *who* did something — is fully preserved here by each admin having their own login rather
than sharing `admin@`.

Note that Cloudflare's list contains read-only roles with names nearly identical to the full ones.
The role to select reads **Super Administrator — All Privileges**.

A third volunteer, if one appears, is a different case: a scoped read-only role would suit them, and
those are free.

---

## 2026-08-04 — The domain is not pointed, and Cloudflare's "Add a site" is not run

**Do not reverse without reading this.**

`luke14ministries.net` still serves the existing Squarespace site. Pointing it retires that site,
which is a board decision rather than a technical step, and it happens in Phase 4.

Worth stating separately because it does not look like the same decision: Cloudflare's "Add a site"
flow *is* pointing the domain. It ends at "change your nameservers at your registrar." The
Cloudflare account therefore stays empty — no zone — until Phase 4.

It is also possible the domain is already on Cloudflare via the current site host, in which
case the eventual move is a zone transfer between accounts rather than a fresh add. That depends on
the still-outstanding question of which registrar holds the domain.

---

## 2026-08-04 — Password vault: Bitwarden Families is the working choice, not yet committed

Bitwarden Families, $47.88/year, up to six users with premium features for every member. The
requirement that decides it is that *both* admins must be able to generate a two-factor code
without phoning the other one. Bitwarden Free has no built-in authenticator at all; Bitwarden
Premium at $19.80/year covers exactly one user, which is the same single point of failure in a
nicer wrapper. 1Password Families is comparable at $53.88/year with no free tier; its nonprofit
program is real but commits to nothing specific in writing.

**Emergency Access is not the reason to buy either one.** It sounds like the answer to "what if one
admin is unreachable," and it is not: Bitwarden's Emergency Access reaches only the grantor's
*personal* vault, not the shared organization collection where the ministry's credentials live.
Bitwarden's own answer for shared credentials is organization account recovery, a Teams/Enterprise
feature and out of scope.

*Corrected 29 August 2026 in DO-THIS-NEXT, recorded here 1 September: the claim above is wrong in
the case that applies. Emergency Access **Takeover** hands the contact the grantor's whole account —
and an Owner's ownership of the organisation goes with it. So it is not too small for this job; it is
far too large, and granting it is a succession decision for the board, not a setting. The practical
conclusion is unchanged: two owners holding the collection live, printed recovery codes offline in two
places, and a periodic encrypted export on offline media.*

Resilience comes from three ordinary things instead: both admins holding the shared collection live
as owners; each account's recovery codes printed and stored offline in two separate places; and a
periodic encrypted vault export on offline media — **never** in OneDrive or SharePoint, because an
encrypted export is still a secret.

Whichever is chosen is billed to the ministry, on `admin@`, and recorded in the account register.

---

## 2026-08-04 — Secrets never enter this repository, OneDrive, or SharePoint

**Do not reverse without reading this.**

Keys live in Vercel's environment variables plus the shared password vault. `.env.local` is
gitignored; `.env.example` is the committed template and contains names only, never values.

Everything is built with Stripe **test** keys and fake data until launch. Live keys appear once, at
go-live, and only in Vercel's environment settings.

The Supabase `service_role` / secret key bypasses row-level security entirely. Server-side only,
from an environment variable, and only where genuinely required — never in the browser, the
repository, SharePoint, or a chat transcript. A secret that appears in a transcript is compromised
and must be rotated.

Row-level security is enforced at the database level rather than in application code. A query that
returns the right rows because the application "would not ask for that row" is not secured.

Background-check paperwork never touches this system: the database stores a boolean and a date, and
the documents live in a permission-restricted SharePoint folder.

---

## 2026-08-04 — Stripe's nonprofit rate does not apply to camp registration

**Do not reverse without reading this.** Recorded because someone will otherwise "discover" the
nonprofit rate and re-run the same dead end.

Stripe's discounted rate of 2.2% + 30¢ is for **donations**. Eligibility requires that more than
**80% of the account's payment volume be tax-deductible gifts**, and Stripe explicitly names
registration fees, tuition and ticket sales as not qualifying. A camp registration is a fee for a
service the family receives, so a registration account fails the test. Applying would waste the
review and return a refusal. Square publishes no nonprofit rate at all.

**The planning number for registration is therefore 2.9% + 30¢.** The project's case is unharmed —
still under half of Campsite's 6% — but the plan should not quote a rate the ministry will never be
charged.

**PayPal's confirmed-charity rate is a genuinely open question**, and the reason is set out in the
5 August processor entry below: its terms exclude some "Payment Types" without publishing a list,
and "Payment Type" means PayPal's products rather than the nature of the income. The open item is
to ask PayPal in writing.

---

## 2026-08-04 — Stripe for registration; PayPal keeps donations; Square keeps in-person

The ministry already used PayPal and Square, so adding Stripe needed a reason better than developer
preference. On price there is barely a reason at all: on a $300 registration Stripe's card fee is
$9.00 and PayPal's Advanced Checkout is $8.96. Anyone claiming a decisive price win either way is
rounding in their own favour.

Stripe was chosen for **registration** on everything other than rate: it is built to be embedded in
someone else's application, which is precisely what this project is; its webhooks are what let the
roster mark itself paid without staff reconciling anything; it has a complete test mode with fake
money, which is the single feature that makes it safe for one volunteer to build a payment flow;
and its documentation is good enough that the next maintainer has a chance. It also offers **bank
transfer at 0.8% capped at $5** in the same checkout — $2.40 on a $300 registration against $18.00
on Campsite — which is the largest saving available anywhere in this project and larger than any
difference between card processors.

**PayPal keeps donations.** Its charity rate of 1.99% + 49¢ genuinely beats Stripe on gifts, and
donors already have accounts and trust the button. Moving gifts to a processor that charges more
for them would be a mistake.

**Square keeps in-person.** At 2.6% + 15¢ it beats every online rate here and the hardware is
already bought, though it is not the cheapest card-present option available — see the PayPal POS
entry below. Square's online rate of 3.3% + 30¢ on the free plan is the worst in the comparison,
which is why it is not the answer for registration.

*Cost of this decision, stated plainly:* three sets of deposits to reconcile rather than one. It is
kept manageable only by the discipline of one purpose per processor. Taking registrations on PayPal
some season because it was quicker is what turns three tidy streams into a reconciliation problem.

*Alternative considered:* consolidating everything onto one processor for the treasurer's sake and
accepting a worse rate somewhere. That is a legitimate board choice and it remains available — but
it should be made deliberately, not by drift.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-04 — The working copy lives at `C:\dev\luke14`, outside OneDrive

**Do not reverse without reading this.**

OneDrive and SharePoint sync corrupts `.git`. The repository was moved out of OneDrive for exactly
this reason and must not be moved back, and no clone should be made inside a synced folder.

Documents go to SharePoint. Code does not.

---

## 2026-08-05 — The registrar never goes inside the hosting account; Cloudflare is deferred, not rejected

**Do not reverse without reading this.**

The question was whether the registrar line can be absorbed by a vendor already on the list.
Checked 5 August 2026: **GitHub does not sell domains at all.** **Vercel does**, passing registry
pricing through, but provides no email service for domains registered with it. **Cloudflare
Registrar does**, genuinely at cost — Cloudflare states it "does not mark up domain prices at all"
— which for `.net` is about $11/year against WordPress.com's $14 and a typical registrar's $15–20.

Consolidating would therefore save roughly **$3 to $9 a year**, against a project whose financial
case is measured in thousands of dollars of transaction fees. That is not a number worth optimising,
and two arguments run the other way.

**The registrar is the vendor you need reachable when another vendor fails.** The domain is the
lever that lets the ministry move: if Vercel has an outage, a billing dispute, or an account
lockout, the recovery is to re-point the domain elsewhere. If the domain lives inside the locked
account, that recovery is gone. **And the domain outlives every technical decision here** — hosting,
database and framework may all change over a decade; `luke14ministries.net` should not have to move
each time.

There is also a timing trap worth recording. **Transferring to Cloudflare Registrar requires the
domain to use Cloudflare for authoritative DNS first** — Cloudflare's documentation is explicit that
you must add the domain to Cloudflare before you can transfer it. Adding the domain means changing
nameservers, which *is* pointing the domain away from the current Squarespace site. **A registrar
transfer to Cloudflare is the domain switch wearing a different hat**, and the domain switch is a
board decision in Phase 4. Anyone who treats it as tidy-up housekeeping will retire the ministry's
live website by accident.

*Alternative considered:* moving to Cloudflare Registrar at Phase 4, when the domain is being
pointed anyway and the nameserver requirement costs nothing extra. That remains genuinely open and
is a reasonable thing to do — it is only the *sequencing* that is decided here.

**One distinction to keep straight, because the two vendors sit in different positions.** The rule
is that the domain must not live inside **the account that hosts the site** — Vercel. Cloudflare is
not the host; it is DNS and edge protection, the place you would re-point *toward*, not away from,
and its at-cost registrar is perfectly defensible on the principle above. The only thing standing
in the way today is the nameserver sequencing described just above.

**Named independent alternative, if one is ever wanted: Porkbun** — `.net` at $12.52 for both
registration and renewal, free WHOIS privacy, SSL and email forwarding, and no relationship to any
other vendor in this stack. Namecheap ($18.58) is the more conservative, better-known option. This
only becomes relevant if the domain turns out to sit somewhere the ministry cannot reach, in which
case moving it to a neutral registrar is a clean step that touches neither DNS nor the live
Squarespace site.

*What is not decided:* where the domain currently is. Tracing that, and getting the ministry onto
that account on `admin@` with 2FA, is Phase 0 work and blocks GitHub domain verification and the
launch DNS change. Reasoning in full: Implementation Plan §8.

---

## 2026-08-05 — Background checks are an open question, not a requirement

The project's documentation treats volunteer background checks as settled, with a design rule
attached: the database stores only `background_check_on_file` and `background_check_date`, while the
paperwork lives in a permission-restricted SharePoint folder. That rule appears in the
Implementation Plan, `CLAUDE.md`, `CONTRIBUTING.md`, the board packet and the phase roadmap.

Traced back, the requirement comes from **one line in the July 2026 decision brief** —
"volunteer applications: application form, the $495/week volunteer fee, and coordination with
background-check paperwork" — plus a second line about sensitive paperwork belonging in
access-controlled storage. Nobody at the ministry has confirmed that Luke 14 runs background checks
today or intends to. An assumption load-bearing in five documents should not rest on one line of an
early brief.

**Decided:** the design rule is kept — it is the right answer *if* checks exist, and it costs
nothing to hold in reserve — but it is now labelled unconfirmed everywhere it appears, and **Phase 2
builds the volunteer application without a background-check field unless the ministry confirms
otherwise.** The question is on the open list (Implementation Plan §11, question 7).

*Why this matters beyond the field itself:* building storage for a compliance process the ministry
does not actually run creates an appearance of compliance that nobody is maintaining, which is worse
than not having the field.

---

## 2026-08-05 — Campsite's cost is two-part, and the fixed half is the larger half

Every earlier version of the plan justified this project on Campsite's **6% transaction rate**
alone. Checked 5 August 2026 across **GetApp, Software Advice, Capterra and Software Finder**, all
four independently list Campsite at **$249 per month**, flat, with no free tier and no free trial.
Software Finder adds implementation at $500–$3,000, migration at $200–$1,000 and custom development
at $100–$200/hr.

**The consequence:** Campsite's fixed cost is roughly **$2,988 a year**, against about **$540 a
year** for everything we are building. The ministry is about **$2,448 a year** better off before a
single registration is processed. Total annual cost at $300 average registrations: at $25,000 of
volume, $4,488 versus $1,290 by card or $740 by bank transfer; at $50,000, $5,988 versus $2,040 or
$941; at $100,000, $8,988 versus $3,540 or $1,340.

**Why this is recorded as a decision and not just a fact:** it changes how the project is
justified. The 6%-only framing made the saving proportional to volume, which implied a quiet
threshold below which the build was not worth doing. A fixed annual platform fee removes that
threshold — the project pays for itself at essentially any volume, including a season with none.
Anyone presenting this to the board should lead with the fixed cost, not the percentage.

**The honest limit on all of it:** none of the four sources is Campsite's own price list, and
Campsite does not publish one. Directory listings go stale and cannot show a legacy or negotiated
rate. **$249/month is a working figure until the ministry's invoice confirms it**, and getting that
invoice is now an item in Do This Next. If the 6% turns out to be all-inclusive, the earlier
framing was right and this entry should be amended rather than deleted.

*Alternative considered:* waiting for the invoice before writing any of it down. Rejected — four
sources agreeing is enough to plan against, and an unrecorded finding is one that gets rediscovered
from scratch in three months.

---

## 2026-08-05 — GitHub Pages is retired, the repository is renamed `website`, and the static export is gone

**Do not reverse without reading this.**

Three things happened in one sitting on 5 August 2026, and they are recorded together because
they are one decision, not three. GitHub Pages is unpublished and its deploy workflow deleted.
The repository is renamed from `luke-14-ministries.github.io` to **`website`**. And
`output: 'export'`, `basePath` and `images: { unoptimized: true }` are removed from
`next.config.mjs`.

**Why they are one decision.** Publishing to GitHub Pages requires compiling the site to flat
HTML — a static export — and a static export has no server behind it, so it cannot query a
database, run an API route, or talk to Stripe. That single setting blocked every item in
Phase 1. It also could not be removed in isolation: take it out and the Pages workflow starts
failing on every push. The coupling is the whole point. Doing Pages-off first and the config
later would have left a window where the project had two broken halves; doing both together
means the coupling simply stops existing.

**The order was deliberate and should be understood before anyone repeats it.** Confirm Vercel
renders. Unpublish Pages. Delete the workflow — skip this and a workflow keeps running and
failing; skip the unpublish and a frozen copy of the site lives at the `github.io` address
indefinitely. Delete the leftover `github-pages` environment. **Rename last**, because
`<org>.github.io` is a Pages *instruction* rather than a label: renaming while Pages was still
live would have stopped the site abruptly instead of gracefully. Only then the config commit.

**What was checked rather than assumed.** The three usual hazards of removing an export config
were all verified absent in the code first: nothing uses `next/image`, so the image-optimiser
setting was inert; nothing calls `generateStaticParams` or any other export-specific API; and
the `asset()` helper reads `NEXT_PUBLIC_BASE_PATH` at runtime rather than depending on the
config's `basePath`, so removing `basePath` could not break it. An earlier draft of this plan
recommended deferring the config change on general caution. That recommendation did not survive
checking the actual code, and was reversed.

**`trailingSlash: true` stays.** It is a URL preference, not a hosting accommodation. Removing
it would turn `/about/` into `/about` across every link in the site.

**No DNS was touched.** The Pages settings screen showed an empty Custom domain field, which is
what made it certain that unpublishing could not affect `luke14ministries.net`. That domain
still serves the existing Squarespace site, and pointing it remains a Phase 4 board decision.

*Alternative considered:* Pages-off and rename now, config change later in the sprint. Rejected
once the code was actually inspected — the risks it guarded against were not present, and the
only reason the Pages retirement was urgent at all was the coupling to the export setting.

---

## 2026-08-05 — `asset()` in `lib/site.js` is left in place as known dead weight

`lib/site.js` exports `asset(p)`, which prefixes a path with `NEXT_PUBLIC_BASE_PATH`. That
variable is unset on Vercel and must stay unset, so the helper now returns every path unchanged.
It is, functionally, a no-op.

It is used in 16 files that otherwise did not need touching on 5 August. Removing it would mean
16 edits across pages nobody was working on, for zero functional gain, with a real chance of a
typo in a file that is currently correct.

So it stays, and this entry exists so that the next person who finds it knows it is deliberate
rather than overlooked. It is fair to remove during unrelated work in those files. It is not
worth a commit of its own.

*Alternative considered:* removing it in the same pass as the config change. Rejected — a
cleanup commit that touches 16 files is exactly the kind of change that hides a real mistake in
a wall of diff.

---

## 2026-08-05 — Stripe keeps registration on approval timing, not on rate

**Do not reverse without reading this.** The processor question was put again — should the ministry
drop Square, and even Stripe, for PayPal? — and answered against PayPal's published fee schedule
(last updated 15 July 2026), its User Agreement, its Confirmed Charity terms and its developer
documentation. The outcome is unchanged; the reason is sharper.

**On rate, Stripe does not win.** On cards the two are a tie ($9.00 against $8.96 on a $300
registration), and if PayPal grants its charity rate — **2.19% + 29¢** on embedded card fields, not
the widely-quoted 1.99% + 49¢ wallet rate — PayPal is cheaper by about $2.14, worth roughly
**$300–600 a season**. Ask in writing; it remains unconfirmed.

**Stripe wins on being able to go live on a date we choose.** PayPal will not process a live card
through Expanded Checkout — the embedded product carrying the good rates — until its underwriting
approves the account. Until then live mode returns `NOT_ENABLED_FOR_CARD_PROCESSING` while
**sandbox works fine**, so the whole flow can be built, tested and demonstrated and still be unable
to take a real card, and **no timeline is published**. Four separate approvals would be needed in
total: Expanded Checkout, ACH Services, POS and the charity rate. Stripe needs none. Against a fixed
registration-opening date and a maintainer whose availability collapses in September, an unbounded
approval queue on the critical path is the wrong risk.

**PayPal cannot put a cheap bank payment in a checkout.** Its ACH Services at 0.80% capped $5 is
rate-identical to Stripe but sits behind its own approval and **does not appear in PayPal's Checkout
SDK at all**; Pay by Bank at 1% capped $10 is **invoicing only**; and a family funding an ordinary
PayPal payment from their bank is charged the ordinary card rate under the fee schedule's E-check
section, saving the ministry nothing. Braintree offers 0.75% but is excluded from its own drop-in UI
and gated behind sales. Stripe's 0.8%/$5 sits in the same checkout as the cards.

**Stripe's bank payment carries caveats that must be designed around**, and the plan previously
understated them: it is a *delayed notification* method confirming in **up to four business days**
(two for eligible accounts), first-time payers verify by bank login or by microdeposits with a
**ten-day** window to complete, and **new accounts carry weekly volume limits** that Stripe does not
publish. A registration season is exactly the volume burst those limits exist to catch. Action:
open the Stripe account early, season it with test volume, and request a limit increase before
registration opens.

**The webhook cannot be rehearsed on PayPal.** Its simulator events cannot be verified through the
production signature path, and the code that marks a registration paid is the riskiest in the
system.

*Checked and closed:* using PayPal *inside* Stripe's Payment Element is not available to US
merchants (eligibility is the EU except Hungary, Liechtenstein, Norway, the UK and Switzerland).
Worth re-checking before Phase 2; nothing should be planned on it.

*On fund holds:* **both** vendors name prepaid goods with long delivery windows and volume spikes as
reserve triggers. Stripe is not immune. The mitigation is the same either way — the ministry's own
database, not the processor, is the authoritative record of who has paid.

**What would reverse this:** PayPal confirming charity pricing on registration *in writing* **and**
granting Expanded Checkout approval, both before mid-September; or Stripe declining or restricting
the account. Even a favourable answer in November is an off-season migration for the following year
— a rate saving that arrives after registration has run is worth nothing.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-05 — Square is displaced on price by PayPal POS, and nothing is being done about it yet

Recorded so that the next person does not have to rediscover it, and so that "Square keeps
in-person" above is not read as a finding that Square is the cheapest option.

PayPal's own point-of-sale product is **2.29% + $0.09** card-present, with a **$29** first reader
(additional readers $79) and **no monthly or setup fee**. Square is **2.6% + 15¢**. On a $40 sale
that is $1.01 against $1.19. PayPal wins, plainly.

**No change is being made.** On perhaps $5,000 of in-person volume across a hundred sales the
difference is about **$21 a year**, against the cost of a new account, new hardware, a fourth
statement for the treasurer to reconcile, and an August afternoon that is needed elsewhere. The
correct time to act on this is when a Square reader needs replacing, or if in-person volume grows
enough to matter.

*Alternative considered:* switching now while the comparison is fresh. Rejected on the arithmetic
above — $21 does not buy a distraction during the one month the maintainer is actually available.

---

## 2026-08-05 — Zeffy is not the registration platform, and a dated fallback trigger is set

Zeffy charges nonprofits nothing — no monthly fee, no percentage — and it is not a trick. The
ministry would hold **its own Stripe Connected Account** underneath, staying merchant of record and
keeping its payment history if it left. It was taken seriously because it is the only option raised
that could make this project unnecessary.

**It is rejected for registration on four grounds, in order of weight.**

*The cost moves onto families rather than disappearing.* Zeffy lives on a **pre-selected** tip added
on top — roughly 17–22% on small amounts, 11–15% on large — prompted **twice** in the flow, with a
documented case of a $400 registration defaulting to add over $40. On roughly $45,000 of season
volume that is about **$1,100 a year** asked of families who are not asked for it today. Zeffy's own
users requested a $0 default; the request drew **224 votes** and was **closed 11 March 2026 without
being granted**, so it is deliberate design rather than a backlog item.

*There is a documented accessibility failure on the opt-out control.* Users report **screen readers
did not work with the dropdown used to reduce or remove the tip.** For a disability ministry, a
payment page whose assistive-technology failure lands exactly on the control for declining an
optional charge is close to disqualifying on its own.

*It cannot do the job.* No instalments, no waivers or e-signature, no file upload, no waitlist, and
a **read-only API** — so no front end can be built on it. The ministry would be sending families to
Zeffy's forms instead of its own site, which is the thing this project exists to stop doing. Camps
using Zeffy in the wild take **deposits** on it and handle the rest elsewhere.

*Vendor durability.* About $4.5M raised, last verified round November 2021, on thin margins. Not a
prediction of failure — a reason not to make it the only registration system.

**The arithmetic, stated honestly**, on roughly $45,000 of season volume: Campsite costs the
ministry about $5,700/yr (if the $249/month fee is real) and families nothing; Zeffy costs the
ministry $0 and families about $1,100/yr; the platform being built costs the ministry about
$1,600/yr all-in and families nothing. **Zeffy therefore undercuts about $1,600 a year of the
financial case for building — not the case itself.**

**Two things follow.** Zeffy for the *donation* page is a reasonable thing to look at separately and
on its own timetable, since a gift page has none of the four problems above except the tip, and on a
gift an optional tip is an ordinary ask. And a fallback is set now rather than in a panic: **if by
1 February 2027 the registration platform is not taking test payments end to end, Zeffy becomes the
season's fallback for taking deposits** while the build continues.

Reasoning in full: Implementation Plan §3b.

---

## 2026-08-06 — Migrations are plain SQL files in the repository, pasted into the SQL Editor

`supabase/migrations/` holds numbered `.sql` files. They are run by opening the Supabase dashboard,
going to SQL Editor, and pasting the file in. Nothing is installed, nothing is generated, and there
is no state held anywhere except the files themselves and the database.

The Supabase CLI is the tool that would normally do this. It was rejected because it adds Docker, a
linked project reference, a login token, and a shadow database — four things that can be in a wrong
state, on a machine that may not be the same machine next August. The paste-in workflow has one
failure mode, and it is visible: the query either ran or it did not.

**The rule that makes this work: a migration is never edited after it has been run.** The file
records what was done to the database, not what we wish it looked like. A change is always a new
numbered file. Break this and the repository stops describing the real database, which is the only
thing it is for.

---

## 2026-08-06 — Phase 1 schema: what is stored, and what is deliberately not

`0001_core_schema.sql` creates sixteen tables. The decisions inside it that are not obvious from
reading it:

**Whether a family has paid is never stored on the registration.** `registrations.status` is
lifecycle only — draft, submitted, waitlisted, confirmed, cancelled. Money is answered by the
`payments` table through the `registration_balances` view, and by nothing else. Two places that both
claim to know whether a fee arrived is how a family gets chased for money they already sent, and it
is the single most common way a registration system loses a family's trust.

**Bank payments are slow, and the schema says so.** `payments.status` includes `processing`, and the
table carries `expected_settlement_on`. Stripe's ACH debit is a delayed-notification method — up to
four business days before success or failure is known. A registration sitting in `processing` is
normal, not a problem to chase. Had this been discovered after launch it would have been a schema
change during registration week.

**Support needs live in their own table, not on the person.** `person_support` is separate from
`people` so it can carry a stricter policy than the row it describes. The fields are free text on
purpose; structure gets added only if the Campsite inventory shows staff genuinely sorting on one.

**Staff notes live in their own table.** Row-level security controls which *rows* are visible, not
which *columns*. A `staff_notes` column on the registration was written first, and the test harness
caught families reading it — a table-level `grant select` covers every column and a column-level
`revoke` does not take it back. `registration_notes` cannot be got wrong by forgetting, and it
carries authorship and history as a side benefit.

**Agreements are versioned and signatures cannot be edited.** "She signed the waiver" is worth
nothing if nobody can say which waiver. `agreement_signatures` has insert policies and no update or
delete policy at all.

**Background checks stay a flag and a date.** `volunteer_clearances` holds
`background_check_on_file`, `background_check_date` and an expiry. No documents, no findings, no
vendor reference numbers. If a column is ever proposed here that would hold the *content* of a
check, the answer is no.

**Age is not stored.** `date_of_birth` is, and age is derived against the session start date. A
stored age is wrong within a year and nobody notices.

Text columns with `CHECK` constraints are used instead of Postgres `ENUM` types throughout: altering
an enum is a migration with transaction restrictions attached, changing a `CHECK` is one plain
statement a volunteer can write. Money is integer cents everywhere, never a float.

---

## 2026-08-06 — Row-level security is proved by a test harness, not by a clean migration

`supabase/migrations/rls_test.sql` seeds four personas — two parents in different households, a
registrar, and a stranger belonging to no household — and asserts forty-two times that each sees
exactly what they should. It runs against a throwaway local Postgres, never the real project.

It exists because a migration that runs without error proves the SQL parsed, and nothing else. Both
of the ways row-level security fails silently — a table with RLS switched off, and a table with RLS
on but no policy at all, which denies everyone including staff — look identical to a successful
migration. The schema file ends with a self-check that raises on either. The harness covers the
harder question of whether the policies that *do* exist are the right ones.

On its first run it found a real hole. That is the argument for keeping it.

---

## 2026-08-06 — Match Campsite's information architecture, not its interface

The existing Campsite portal is being walked and written down before more of the registration flow
is built, using `Luke14-Portal-Inventory.xlsx` (SharePoint, `02 Accounts and Setup`).

**What is being copied:** what a family is asked, in what order, which answers are required, what
the dropdown choices are, what states a registration can be in, which emails fire and when, and what
staff see on the other side. This is where an omission costs a season — a field nobody remembered is
a field a hundred families have to be emailed about in July.

**What is not being copied:** the interface. Campsite's is a PHP-era design and accessibility is the
one dimension where a disability ministry should beat the incumbent rather than tie it.

*Constraint on the exercise:* the workbook records structure only — labels, choices, screen order.
No camper names, no medical details, no addresses, no payment records, and none of that into a chat
transcript either. The portal holds real family data; the inventory must not.

---

## 2026-08-06 — Authentication is Supabase Auth, with the session refreshed in middleware

Families and volunteers log in with an email address and a password, held by Supabase Auth. No
password ever reaches this codebase; nothing about a login is stored in our own tables except the
profile row that a database trigger creates.

Three Supabase clients exist, and using the wrong one is the mistake this note is here to prevent:

- `lib/supabase/client.js` — for components with `'use client'`. Runs in the browser.
- `lib/supabase/server.js` — for pages without `'use client'`, route handlers, and server actions.
  Built fresh per request from that request's cookies, because one shared client would leak one
  visitor's session into another's page.
- `lib/supabase/middleware.js` — used only by `middleware.js` at the repository root.

**Server code asks `getUser()`, never `getSession()`.** `getSession()` reads the cookie and believes
it. `getUser()` asks Supabase to verify the token. On the server, where the answer decides what data
someone sees, only the verified one is worth having.

**`middleware.js` is not optional and must stay at the repository root.** A Supabase access token
expires after an hour, and nothing in the browser can refresh a cookie for a server-rendered page
that is already being requested. The refresh happens in middleware, before any page runs. Delete it
and the site works for about an hour, then people begin getting logged out mid-form, with no error
and no pattern anyone can reproduce. Next.js finds this file by location, not by import: move it
into `app/` or `lib/` and it silently stops running.

**Middleware redirects, row-level security protects.** The redirect on `/account/dashboard` is a
courtesy so anonymous visitors see a login screen instead of an empty page. It is not the security
boundary — the policies in `0001_core_schema.sql` are. If middleware were deleted tomorrow, nobody
could read another family's data.

**Log out is a POST, not a link.** A GET that logs you out can be fired by anything that makes a
browser fetch a URL — an image tag in an email, a link on another site. That is how people end up
mysteriously logged out halfway through a registration.

**Wrong-password and unknown-email give the same message.** Supabase tells the difference; the form
deliberately does not repeat it. Otherwise the login page becomes a way of finding out which
families have accounts here. The forgot-password form ignores its result for the same reason.

**Email confirmation stays on.** It is what stops someone registering a family under an address they
do not own. The consequence is that `signUp()` returns no session, so nothing can be written to the
database on the signing-up person's behalf until they click the link — which is why the profile row
is created by a trigger running as the database owner rather than by the app.

**Emailed links all land on `/auth/callback/`**, which handles both link shapes Supabase can send
(`?code=` and `?token_hash=&type=`) so that editing an email template later cannot silently break
confirmation for every new family. It only ever redirects to a path on this site; taking a full URL
from the query string is the open-redirect bug.

The alternative considered was server actions rather than browser-side calls in the form components.
Browser-side won because it leaves the existing form files the same shape — a volunteer reading the
diff sees the same file with the fake submit replaced by a real one — and because inline error
messages need no extra plumbing.

---

## 2026-08-06 — `handle_new_user()` also copies the phone number

`0001_core_schema.sql` was amended before it had been run anywhere, which is the only time a
migration may be edited. The trigger now writes `phone` into `public.profiles` alongside the two
names.

It matters because there is no other moment to do it. With email confirmation on there is no session
immediately after `signUp()`, so a follow-up write from the app would be refused by row-level
security — correctly. The three metadata keys `first_name`, `last_name` and `phone` are set in
`app/account/signup/SignupForm.jsx` and read in the trigger; rename one on either side and nothing
errors, the profile simply comes out blank.

---

## 2026-08-07 — Automated email goes through Resend, from the ministry's own domain

Every message the system sends — email confirmation, password reset, registration received, balance
due, forms outstanding — is sent by Resend from `registration@luke14ministries.net`.

Free to 3,000 messages a month on one verified domain, with a 100-a-day cap; $20/month lifts both,
which we will want the first time anyone emails every family at once.

Postmark was the alternative and is the better-known name, but its free plan is 100 messages a
month — an evaluation sandbox, not a usable tier. Resend gives the ministry a functional free tier
at our volume and is built for the same Next.js ecosystem this site is written in, which is one
less unfamiliar thing for a future volunteer. Switching later is an API key and a template port.

This is not optional infrastructure. Supabase's built-in sender is explicitly for development, so
sign-up confirmation and password-reset messages need a real sender before launch regardless of
whether a single reminder is ever sent.

Setup means SPF, DKIM and DMARC records at the registrar. Those are TXT records; they do **not**
move where `luke14ministries.net` points, so this can be done before Phase 4 without touching the
Squarespace site. It does need coordinating with whoever administers the Microsoft 365 mail — a
careless SPF edit breaks the ministry's existing email.

Every message sent is logged: recipient, template, timestamp, and what it referred to. "We told you
on the first" needs to be answerable from a record.

---

## 2026-08-07 — Payment plans are billed as statements, not pre-authorised charges

Installments are emailed as a statement with a button to pay that exact amount. The ministry does
not store a card and draw on it.

The reason is the blast radius of a mistake. When the ministry can initiate a charge, every bug,
mis-set date and duplicated row is capable of taking money out of a family's account with nobody
present — which has already happened once under CampSite, where an unauthorised draft bounced and
cost more to unpick than the payment was worth. A wrong number in a statement email is embarrassing
and fixable by apologising. A wrong number in an automatic draft is somebody's rent.

It is also less work, which is the rare case where the safer option is the cheaper one. Automatic
collection is four features, not one: storing a card under a compliant agreement, charging it
off-session, handling the substantial share that fail on expired cards or bank authentication, and
chasing the family back online. That last part is most of the effort.

It can be layered on later without rework, because the schedule and the amounts are already
calculated. It should be a deliberate decision with real numbers in hand, not a Phase 2 default.

---

## 2026-08-07 — Pricing arithmetic lives in our database; Stripe is handed a settled figure

Fees, early-bird rates, coupon codes, scholarships and discounts are calculated in Postgres. Stripe
collects one number.

Stripe can do this work — its promotion codes support single-use and multi-use redemption limits,
expiry dates, minimum amounts and codes tied to one customer — so this is a decision, not an
oversight.

Two reasons against using it. Cost: Stripe adds 0.4% per invoice for its invoicing product and 0.7%
of volume for subscription billing, and this project exists to get fees down from 6%. And the
books: what a family owes must be answerable from one place. Two pricing engines eventually
disagree, and that is the day the treasurer cannot reconcile the year.

---

## 2026-08-18 — Stripe's nonprofit rate was applied for anyway, and granted

**Supersedes 2026-08-04, "Stripe's nonprofit rate does not apply to camp registration."** That
entry carried "Do not reverse without reading this." It was read, and reversed on evidence.

The application was submitted and **Stripe granted the discounted nonprofit rate on 18 August
2026**. The planning number for registration is no longer 2.9% + 30c.

**Be fair to the original entry, because most of it was right.** Its reading of the published
policy was accurate: the rate is written for donations, the 80%-of-volume test is real, and Stripe
does name registration fees and tuition as non-qualifying. Anyone reasoning from the documentation
alone would have reached the same conclusion, and the entry was written to stop the same dead end
being rediscovered. That was a sensible thing to want.

**What it got wrong was the step from "the policy says no" to "do not ask."** The account is the
ministry's whole payment relationship, not the camp line item alone, and eligibility was assessed
against a registered 501(c)(3) as a whole rather than against a single product. The published test
turned out to be the starting point of a review, not a gate applied mechanically. The cost of
asking was one form and some waiting; the entry priced that as wasted effort, and it was not.

*The general lesson, which is worth more than the rate:* a published eligibility rule is evidence
about the likely answer, not the answer. Where the downside is a form and the upside is a
permanent rate reduction on every transaction the ministry will ever take, ask. Record the
refusal if it comes.

*Housekeeping:* anywhere the plan quotes 2.9% + 30c as the registration rate now understates the
project's case rather than overstating it, which is the safe direction to be stale in. Correct it
when touching those documents; do not go hunting.

---

## 2026-08-24 — The ministry can give money back, and a refund is its own record

Migrations `0038` and `0044`. The board's position, relayed 24 August: the site must be able to
return money, not only credit it against a future balance. Until then "we'll put it toward next
year" was the only answer available to a family whose circumstances had changed.

**A refund is a row in `payment_refunds`, not a negative `payments` row.** The negative-row trick
makes the balance arithmetic fall out for free and is wrong three times over: `amount_cents` is
CHECKed greater than zero (settled in `0001`); "money arrived" and "money left" would become
indistinguishable in every list, export and receipt; and a refund has facts of its own — which
payment it reverses, who authorised it, Stripe's refund id — with nowhere to live on a payment row.

**Partial refunds are the normal case**, not the exception — one child of three withdraws, or a
deposit is forfeited and the balance returned. So many refunds may point at one payment, and
`0044` adds the database trigger that stops their total exceeding it. The server action checks
this in JavaScript too; that check is a courtesy, not a boundary, because two registrars on two
screens or one impatient double-click both defeat it. Without the trigger a slipped decimal could
refund $500 against a $50 payment and invent a credit the ministry never received, on a screen
families read as authoritative. Headroom counts the payment plus its `fee_cover_cents` — that
money did arrive — and excludes `failed` and `canceled` refunds, because a refund that did not
happen must not consume the room for one that should.

**Fee cover is refunded deliberately or not at all.** Stripe does not return its cut, so refunding
the ~3% a family added costs the ministry real money. Staff can still choose to, because "you
can't have your $2 back" is a bad conversation — but it stays a separate, visible number rather
than something that happens silently.

---

## 2026-08-24 — An external waiver is acknowledged, never signed

Migration `0039`. Horseback stables and rafting outfitters run their own paperwork on their own
websites. The ministry cannot sign for a family, and this site cannot know whether they did.

So the column records the only thing we can honestly assert: that we told them, and when they said
they understood. It is called `waiver_acknowledged_at`.

**The naming is the decision.** A column called `waiver_signed_at` would eventually be read as
proof, in the one conversation where proof matters — after someone is hurt. The database must not
be able to claim something the ministry never obtained.

---

## 2026-08-24 — Capacity counts come from a counts-only function, not from readable rows

Migration `0040`. A family may only select their own `activity_signups`, which is right — who else
is going riding is nobody's business. That makes "4 places left" unanswerable from the client,
because counting requires reading rows the caller cannot see.

A `SECURITY DEFINER` function is the narrow, deliberate exception. It returns **counts only** —
never a name, never a row — which is exactly the amount of other people's data a capacity number
has to reveal. Widening it later to return anything row-shaped is a different decision and should
be recorded as one.

---

## 2026-08-24 — Horseback is volunteer-run, and its provider is null on purpose

Migration `0041`. The `0039` seed guessed "Local stable partner". Lawrence corrected it on 24
August: the horses have historically come from volunteers and friends of the camp, and whether any
waiver applies is unknown.

**Null is not missing data here; it is the honest value.** `provider_name` is what makes the family
screen say the provider's own form has to be completed and demand an acknowledgement tick. A
guessed provider would have the site instructing families to go and complete paperwork that may
not exist — asserting a fact nobody has established.

*Open question for staff:* does volunteer-run horseback need a waiver of its own, and if so is it
the ministry's or the owner's? It is on the Staff Questions log and stays there until answered.

---

## 2026-08-24 — Lodging is one self-referencing table, and `accessible` is first-class

Migrations `0042` (the table and assignments) and `0043` (placeholder cabins). The one part of the
system `0001` did not model, so the shape is a decision rather than a discovery.

**Why lodgings nest via `parent_id`.** Lawrence, 24 August: "in some cases, especially for
volunteers, room assignments are just cabin assignments." Both are true at once — a volunteer goes
in Cabin 3 and that is the whole answer, while a family goes in a particular room inside the
lodge. Two tables, `cabins` and `rooms`, would force every query to ask which kind it is dealing
with and force staff to pick the right screen before doing the obvious thing. One self-referencing
table lets a cabin *be* somewhere you assign a person and also *contain* somewhere you assign a
person. Occupancy of a cabin is then its own assignments plus its children's, which is how a camp
director counts beds.

**`accessible` is not a nicety.** This is a camp for people affected by disability. A bed
assignment that ignores wheelchair access is a failure, not an inconvenience, so the flag is
first-class and the assignment screen warns when someone with mobility notes lands somewhere not
marked accessible. `0043`'s seed marks accessibility honestly rather than optimistically — an
unmarked cabin reads as "not known to be accessible", which is the safe direction to be wrong in.

*The seeded names and capacities are invented and meant to be corrected by staff.* What matters is
that the shape is right.

---

## 2026-08-25 — A family asks to cancel; staff decide and act

Migration `0045`. Cancelling had been blocked on the board's refund rule. It is not blocked, once
the two are separated: **a family can ask to cancel with no refund policy in existence.** Staff
receive the request and settle the money by whatever policy applies. That unblocks the thing
families actually need — a way to say "we can't come" — without the site inventing a rule nobody
has made.

It is also the safer shape. Cancelling releases a place and may forfeit money. That is not an
action to hand a family behind a confirm dialog at eleven at night; a request is reversible right
up until staff act on it.

**`participant_ids` empty means the whole registration.** Families cancel one child far more often
than the whole family, and a request that cannot say "just Sarah" would be answered by a phone
call instead — which is the thing this exists to avoid.

---

## 2026-08-25 — A change to who someone is gets logged, staff included

Migration `0046`. `log_family_change` exists to show staff what *families* changed, so it skips
edits made by staff themselves. Sensible for its purpose, and wrong for one narrow case.

First name, last name and date of birth are not ordinary fields. Rosters, check-in lists and
signed agreements all carry the name, and `submit_family_registration` **matches returning people
by name and date of birth** — so changing either silently detaches someone from their own history
and produces a duplicate at the next registration.

Families are now blocked from editing these while a live registration exists, and told to ask
staff. That advice pointed straight at the one path with neither a guard nor a record: staff could
do the same thing more easily and nothing anywhere would show it had happened. The trigger closes
the record half; an explicit confirmation on the staff screen closes the other.

**Everything else keeps the old behaviour.** Staff edits stay out of the log, because Recent
Changes is a review queue for family activity, not an audit of the ministry's own staff.

---

## 2026-08-25 — Camp weeks move to 2027, and the dates are NOT confirmed with the venue

Migration `0047`. **Do not reverse without reading this.**

The two Camp Celebrate weeks were seeded at July 2026. That season has happened, so every family
dashboard showed both weeks greyed as "past" while the Adult Adventure Retreat sat above them as
the only upcoming thing. The sort was right; the data was stale. The season the platform is
actually being built for is 2027.

    Adult Adventure Retreat 2026   29 Oct 2026        (genuinely next, unchanged)
    Camp Celebrate 2027 - Week 1   19-23 Jul 2027
    Camp Celebrate 2027 - Week 2   26-30 Jul 2027

Week 2 has always immediately followed Week 1, Monday to Friday then the next Monday to Friday,
and 2027 lines up on the same weekdays — so this is a straight shift of the same shape by 364
days, not a new pattern.

**These dates are a mechanical shift, not a confirmed booking.** Carson Springs has to give the
ministry its 2027 weeks before any of this goes public. If they come back different, change them
here or in Setup; nothing downstream hardcodes them. Publishing an unconfirmed camp date is how
families book flights around a week that does not exist.

---

## 2026-08-25 — The family's own words and the registrar's note are different columns

Migration `0048`. `scholarships.family_statement` is the family's own account of why the fee is
hard — the single most useful thing on the record when somebody in the office picks up the phone.

`setAdjustments` had been overwriting it. The staff "Note (kept with the scholarship record)"
field wrote straight into `family_statement`, so the moment a registrar granted an award the
family's explanation was replaced by "Board-approved hardship scholarship" and was gone. Nothing
warned anybody, because the note that replaced it looked like a note.

One column fixes it. These are two different claims by two different people and should never have
shared a home: `family_statement` is what the family told us, never edited by staff; `staff_note`
is what staff decided and why.

**No backfill is possible.** The overwritten statements are not recoverable and none is attempted.

---

## 2026-08-25 — A signature typed on this site must name the household contact

Migration `0049`. Testing found a registration for two people — an adult and a seven-year-old —
whose six signed agreements all read "Alberto Gonzales", a name belonging to nobody in the
household. A release has to name the person accountable for it.

The form and the server action both refuse that now, and **neither is a boundary.**
`submit_family_registration` is `SECURITY INVOKER` (correct — RLS applies to everything it writes)
with EXECUTE granted to `authenticated`, so any signed-in person can post to it directly with a
payload of their choosing, and a rule living only in JavaScript would not be there. The same is
true of the scholarship agreement. The trigger is where the rule actually lives.

**It applies to `signed_here` and to nothing else.** `self_reported`, `paper_on_file` and
`confirmed_external` are staff recording a signature that happened elsewhere — a form brought to
camp, a release posted in. Who may sign one of those is a policy question for the board, it is on
the staff questions list, and until they answer it staff judgment governs. A database trigger must
not pre-empt that answer. It also fires only where there is something to check against: a
household with no primary contact recorded yet cannot contradict anybody.

---

## 2026-08-25 — The seeded activities are replaced with what camp actually does

Migration `0050`. The eleven seeded activities were placeholders written from the schema rather
than from camp. Five corrections, each from a line of the testing notes: horseback is **not**
capacity limited (a cap camp does not have is worse than no cap — it turns families away from
something that had room); swimming and arts and crafts need no sign-up and now say so; white water
rafting runs on the Wednesday of camp and was missing from both camp weeks; pontoon runs on the
Tuesday and needs a boarding time, which is a build and not a data change; zip line and hiking come
off the retreat, set **inactive rather than deleted** so nothing about who already asked for them
is destroyed.

**The tone rule is part of the decision.** Camp exists to make it possible for everyone to do
everything — wheelchair users go down the river and up the climbing wall. Activity copy reads as
an invitation and a practical note, never as a list of conditions.

---

## 2026-08-25 — A narrow set of safety fields is logged whoever changes it

Migration `0051`. Testing, 25 August: a staff account edited a camper's description of her
seizures, it changed in staff view, and nothing appeared in the review queue.

The change log was working as written — `log_family_change()` skips staff edits on every table
except `people`. That is a correct diagnosis and the wrong rule for this field. `0046` already
carved out identity fields for the same reason: some changes matter regardless of who makes them,
because the question the record answers is not "who is editing without permission" but **"does
anyone know this changed"**. A seizure description is the clearest case in the schema — the camp
nurse's list, the buddy's briefing and the medication plan are all built from it, and a staff
member correcting it at eleven at night is exactly the circumstance in which nobody else finds out.

**The set is deliberately narrow:** seizures, rescue medication, allergies, medications. Everything
else on `person_support` keeps the staff skip. A registrar tidying a dietary note should not fill
the review queue, and a queue that fills with housekeeping is a queue nobody reads.

---

## 2026-08-25 — Activity time slots are wall-clock, not `timestamptz`

Migration `0052`. The pontoon goes out four times on the Tuesday and the salon takes one person at
a time, so "who is on the 2 o'clock boat" is the question the day is run from. `activity_slots` has
existed since `0001`, unused and holding zero rows, which meant it could be shaped properly rather
than worked around.

**"Tuesday at 2pm" at camp means 2pm at camp.** It does not shift because the coordinator setting
it up is sitting in Mountain time, and it does not shift if the clocks change between now and July.
`timestamptz` is an instant on the world's timeline — the right type for a payment, the wrong one
for this. Storing an instant forces every read and write through a timezone conversion, and the
failure mode is silent: a boarding time an hour out, discovered at the dock.

So the columns are a date and two times, meaning exactly what they say at the place the activity
happens. Nothing converts, so nothing can convert wrongly. The old `timestamptz` columns are kept
but made optional — unused and unpopulated, they cost nothing to leave, and dropping a column
other code might reach for costs a migration.

---

## 2026-08-26 — A pending refund is not money the family has back

Migration `0053`. `registration_balances` subtracted **pending** refunds from `paid_cents` — money
that had not left the ministry was being counted as already returned. Found in testing on a real
registration: $960 in fees, a $240 scholarship, $960 received across two payments, and $470 of
refunds both still pending. The page said "Paid $490 - Balance $230" and offered a "Pay $230.00"
button. The ministry was holding all $960 of the family's money and asking for $230 more, at a
moment when the family was $240 **in credit**.

The end state was right — once both refunds land, $490 net against $720 owed really is a $230
balance. **The error is one of timing, and timing is the whole point of a balance: it is what is
true now.** So `paid_cents` counts only refunds that have succeeded, and refunds in flight get
their own column, so a screen can say "a $470 refund is on its way" without that sentence silently
moving what somebody owes.

**Not changed:** `payment_refundable` from `0044` still counts pending refunds against what is left
to refund, and must. That view answers "how much of this payment could I still send back", and
money already in flight is not available to send twice. The two views count differently because
they answer different questions — which is worth remembering before anyone "fixes" the
inconsistency.

---

## 2026-08-26 — The payer is snapshotted on the payment, and service_role gets an explicit GRANT

Migration `0054`. Two findings from one afternoon's testing, both about a payment record that
cannot answer a question asked later.

**The refund webhook was being refused at the table.** A $10 refund issued in the Stripe dashboard
never appeared on the site. Stripe delivered the event, the function returned 200, and nothing was
written: `permission denied for table payment_refunds`. `service_role` bypasses RLS; it does
**not** bypass table GRANTs, and `payment_refunds` had none — only `payments` and `gifts` were ever
granted, back in `0006` when the payment webhook was built. Every other table is closed to
`service_role`, which is the right default and stays; this grants exactly the one table the refund
webhook touches and exactly the three verbs it uses. No DELETE — a refund record is history.

*The failure mode is the part worth keeping.* The webhook logs the error and returns 200
deliberately, because a non-200 makes Stripe retry the same doomed call for days. So a permission
problem here is **silent from the outside**: Stripe says delivered, the site shows nothing, and the
two disagree with no error anywhere a person would look. For the next edge function, check GRANTs
first, not signatures.

**Payments now carry a payer snapshot.** A family paid $50 and then changed their contact email;
Stripe showed the address used at checkout, the portal showed the new one, and nothing joined them.
`payments` had no payer identity at all — it leaned on registration to household to current contact
details, which is a **live** lookup: it tells you who the family is today, never who handed over
the money in March. The snapshot is written once when the payment is recorded and never updated.
It is deliberately not a foreign key and deliberately not kept in step with the household —
drifting apart is the entire point. If the two differ, both facts are true: this is who paid, that
is who the family is now. Grandparents, churches and friends pay for camp too, so this was never
reliably the household's email even before anybody edited anything.

---

## 2026-08-26 — `search_path` is pinned on the last two functions; the other 60 advisor warnings are left alone

Migration `0055`. Supabase's security advisor flagged two functions with a mutable `search_path` —
`set_updated_at` from `0001` and `agreement_signature_names_contact` from `0049`. Everything else
in the schema already pins it.

**Why this one matters.** A `SECURITY DEFINER` function runs with its owner's rights. Without a
pinned `search_path` it resolves unqualified names using the **caller's** search path, so a caller
able to create a schema can put their own `people` table ahead of ours and have a function running
as the owner read it instead. That is a real escalation shape, and pinning closes it outright.

**Why the other 60 notices are deliberately left.** Postgres grants EXECUTE on every new function
to PUBLIC, so `grant execute ... to authenticated` never removed anon's access, and every
`SECURITY DEFINER` function shows up as anon-callable. Each was checked by hand. Every `admin_*`
function guards itself. The six with no internal role check are `activity_availability` and
`activity_slot_availability` (counts only, built to be callable), `buddies_published` and
`lodging_published` (a boolean about an event), `can_touch_person_photo` (scoped through
`my_household_ids()`, so a logged-out caller gets false), and `rls_auto_enable` (an event trigger,
not reachable as RPC at all).

**Revoking those grants would break RLS.** The `is_*` and `my_*` helpers are called from inside
policy expressions, and a policy expression runs as the querying role — revoke EXECUTE from anon
and the policy **fails** rather than returning false. Tidying it safely means checking every policy
first, and that is not a change to make in the week before go-live to silence a warning. A green
advisor dashboard is not the goal; a correct one is.

---

## 2026-08-26 — Background-check storage was built after all, and the original question is still open

**Supersedes 2026-08-05, "Background checks are an open question, not a requirement."** That entry
decided that Phase 2 would build the volunteer application **without** a background-check field
unless the ministry confirmed it runs checks.

Migration `0029` built `volunteer_clearances` anyway: a table with Checkr integration columns —
`provider`, `checkr_candidate_id`, `checkr_invitation_id`, `checkr_report_id`, `checkr_package`,
`checkr_status`, `adjudication`, `invitation_sent_at`, `report_completed_at`, `last_synced_at` —
alongside the original `background_check_on_file` and `background_check_date`. It is a **placeholder
by its own header**: the columns are real, no API key has been issued, no webhook handler exists
and nothing writes them.

**What the reversal bought.** The design is genuinely better than what it replaces. CampSite's
volunteer form asks for a Social Security number in a plain required text field, which means the
vendor stores it and staff can read it. Checkr's hosted invitation flow means we create a candidate
with an email address and nothing else, Checkr collects the SSN and date of birth on its own form,
and a webhook returns pass or fail. Luke 14 never receives, transmits or stores the number. It
cannot leak from us because we never have it, and staff cannot read it because it is not here. That
promise is written into the table comment as a rule: a future self-hosted flow collecting PII into
this table needs a board decision, not a pull request. The integration carries no separate fee — it
saves no money, it removes a liability.

**What has not changed is the thing the original entry was actually about.** Nobody has recorded
that the ministry confirmed it runs background checks, or intends to. The 2026-08-05 entry traced
the requirement to a single line in the July 2026 decision brief and put it on the open list as
Implementation Plan section 11, question 7. **That question has still not been answered anywhere in
this repository or in SharePoint**, and the absence of an answer is itself the finding: storage now
exists for a compliance process nobody has confirmed the ministry operates.

The original entry's warning was that building storage for a process the ministry does not run
"creates an appearance of compliance that nobody is maintaining." Empty placeholder columns are
exactly that appearance. The reversal is accepted — the shape is right and costs nothing to hold in
reserve — but **the open question is re-raised, not closed**, and it must be answered before
anything writes to this table or before the volunteer application implies to anyone that a check
will happen.

---

## 2026-08-26 — This log lapsed for nineteen days, and migration headers became the record

Between 2026-08-07 and today, nothing was written here. In the same nineteen days the project
shipped the volunteer application, Turnstile on the account forms, refunds end to end, cancellation
requests, lodging, activities, the payer snapshot and eighteen migrations. Every one of those
decisions was argued and written down — in the **header comment of the migration that made it**.

Those headers are good. They are long, they state the alternative, and several of them are better
written than the entries above. That is exactly the problem, and it is worth naming rather than
quietly fixing:

- **A migration header is filed by the change, not by the question.** "Why does a pending refund
  not count as paid?" is answerable only by someone who already knows to open `0053`. This log is
  the index; the headers are not.
- **Headers record decisions that touched the database.** Turnstile, the Vercel plan, the Stripe
  nonprofit application and the state of the contact form left no migration and therefore left no
  record at all until today.
- **A header cannot supersede anything.** The two reversals above — the Stripe rate and the
  background-check field — were decided in an application form and a migration respectively, and
  the entries they overturned sat here unmarked for weeks, one of them still reading "Do not
  reverse without reading this."

The nineteen entries above this one are a backfill, written on 26 August from the migration headers
and from the state of the repository. **A backfill is not the same thing as a contemporaneous
record** — it is written by someone who already knows how the story turned out, which is precisely
the bias this log exists to avoid — so they should be read as reconstruction, and where a date came
from a header's "APPLIED on" line rather than from a commit, that is the best available and not a
certainty.

**Restarting the practice.** The rule from the top of this file has not changed and did not need
changing: one short entry per real choice, written when the choice is made. The migration header
stays where it is — it is the right place for the detail, and it travels with the code — but any
decision worth a header is worth three lines here on the same day, and a decision that touches no
migration is worth them more, not less. `CLAUDE.md` was corrected on the same day and had drifted
in eight separate places over the same nineteen days, which is the second-order cost of a log
nobody is writing to.

---

## 2026-08-29 — Stripe's agent and AI tooling was considered and declined

Stripe's "Agents and AI" page was reviewed. Almost none of it applies: agentic commerce, product
feeds, the Stripe Directory and LLM token billing are built for businesses whose *customers* are
software. Ours are families. Nothing on the page solves a problem we currently have.

Two items are parked rather than dismissed. The **Stripe CLI** (`stripe listen`, `stripe trigger`)
would have shortened the refund-webhook hunt, where the endpoint returned 200 while failing
silently, and it is the right way to prove live-mode webhooks at go-live without moving real money
— a go-live note, not a task for now. The **Stripe MCP server** would need read-only, test-mode
scoping before it went anywhere near this project, and offers nothing the dashboard doesn't.

Revisit only if a concrete need appears. Vendor pages of this kind are written to make a small
operation feel behind; being behind on something you have no use for is not a cost.

---

## 2026-08-29 — Sending as an alias works after all, and the earlier entry was written too soon

On 27 August this project concluded, in writing and in three places, that Exchange rewrites the From
address on a shared mailbox to the mailbox's primary — so choosing `registration@` or `camp@` in the
From dropdown would still arrive as `info@`. The tenant setting meant to allow it
(`SendFromAliasEnabled`) had been turned on that morning and repeated tests showed no change. The
conclusion was recorded as a design constraint: one outbound identity, treat it as the design.

It was wrong. The setting took roughly **two days** to take effect. A test on 29 August arrived as
**Luke 14 Ministries `<registration@luke14ministries.net>`**. Alias sending works; the display name
stays *Luke 14 Ministries* either way, which is what we wanted — one voice, with the address saying
which door a reply should come back through.

Corrected in `lib/site.js`, the Web Admin Handbook §10.1 and the account register.

**The generalisable part, which is why this is an entry and not just an edit.** A tenant change that
has not propagated is indistinguishable from a tenant change that does not work. Two days of
confident testing produced a confident, wrong, *written* conclusion — and a written conclusion is
worse than no conclusion, because the next person inherits it as fact. When a setting is toggled and
the behaviour does not change: wait a day, test again, and only then write down a limitation.

---

## 2026-08-29 — A program leader is not staff, and the view is the whole permission

*Written 30 August, a day after the fact. Flagged as late rather than dated back: the entry above
this one exists because a decision recorded late is recorded by someone who already knows how it
turned out.*

Camp needed the person running archery to know who is in archery. The obvious implementation — a
fourth staff role — was rejected, because every role in `lib/staff.js` is a set of *table*
permissions, and a leader who can select a participant row can select every column on it. "Which
columns" was the entire question.

So a program leader has **no row in `staff`**, no role, and none of the staff permissions. They
hold a grant in `program_leaders` naming one program at one event, and that grant buys exactly one
thing: the right to read `public.program_roster`, a view carrying names, ages, a buddy, and
**flags** for allergies and support needs. None of the narrative columns — disabilities,
medications, behaviour triggers — is in it, and none should be added. The intended failure mode is
that a leader learns to ask the coordinator.

An earlier draft of `0061` added a policy on `registration_participants`. It was removed. There is
deliberately **no** new policy on `registration_participants`, `people` or `person_support`: a
leader gets no direct read of any table, only the view.

Two consequences worth knowing before touching this. A leader reaches `/admin`, which had been a
staff-only area — `app/admin/layout.jsx` now builds their navigation *separately* rather than
filtering `NAV` down, so that adding a page to `NAV` can never accidentally hand it to a leader.
And leaders are held to the same two-factor enrolment rule as staff. That is real friction for a
volunteer at camp, and it was chosen anyway: what is behind the door is a list of disabled
children's first names, and a password alone is not enough of a door in front of that. If it
proves too much, it is one line in the layout — but revisit it deliberately.

---

## 2026-08-30 — `program_roster` is a SECURITY DEFINER view, and the ERROR advisory is accepted

Supabase's security advisor reports exactly one ERROR against this project:
the view `public.program_roster` is defined with the SECURITY DEFINER property. It is accepted, and
this entry is the answer somebody will want at go-live when they open that list and find a red row.

**It has to be SECURITY DEFINER.** A program leader holds no read on
`registration_participants`, `people` or `person_support` — that is the point of `0061`, decided
in the entry above. A view running as the *invoker* would therefore return nothing to the only
people it exists for.

**The safety is the view's own row filter**, not the definer property:

    where public.is_staff() or public.leads_program(rp.program_id, r.event_id)

Staff see every program, a leader sees only the program they lead at the event they lead it at,
and everyone else — including a signed-in family — sees nothing. The grant is `select` only, to
`authenticated` and `service_role`.

**Do not silence it by switching to `security_invoker = true`.** That would satisfy the advisor
and empty every leader's roster, and it would do so with no error — the page would render, with
nothing on it. This is the exact shape of failure this project keeps meeting, so it is written
down here rather than left to be rediscovered.

The advisor also reports 69 warnings: 68 `security_definer_function_executable` (the same category
accepted on 2026-08-26, for the same reason) and `auth_leaked_password_protection`, which is a
Pro-plan feature and arrives with the upgrade already planned for go-live — see `DO-THIS-NEXT.md`,
which asks for the free-plan substitute (a longer minimum password) in the meantime.

**The generalisable part.** An accepted advisory is only accepted if the acceptance is written
down. The 26 August entry covered the warnings that existed *then*; this ERROR arrived three days
later and would have read, to anyone opening the dashboard cold, as an unreviewed security hole in
the newest code in the system. A vendor's warning list is a document other people read without us.

---

## 2026-08-31 — one person, two roles at one camp: the second role is free, not discounted

A parent who is also volunteering is rare and real. The ministry charges such a person **once**.

**The accounting choice, which is invisible from the screen and is why it is written here.** The
second role carries **`fee_cents = 0`** rather than a full fee cancelled by a matching discount.
The parent row holds the real fee; the volunteer row holds nothing.

Everything downstream then keeps working with no change at all: the balance view, the deposit
(which multiplies fee-bearing heads), the statements, the CSV exports, refunds. There is no second
charge anywhere that has to be reconciled against a second credit. **A zero is easier to audit than
two numbers that must always cancel** — and a discount that silently stops matching its fee is
the kind of error nobody notices until a family is invoiced twice.

**No schema change was needed, which is worth recording on its own.** The unique on
`registration_participants` is `(registration_id, person_id, event_option_id)` — `person_id` is
not unique by itself — and `event_options` has always carried a nullable `participant_role`, with
`0001` noting that "the retreat publishes two options, one per role". Two roles for one person was
designed in from the start and never used. Migration `0069` only publishes the second option.

**The trap it created, and closed.** Publishing a second option per event broke an assumption four
places were quietly making: `event_options.find((o) => o.published)` — take whichever comes back
first. That was fragile the day it was written and became a **money bug** the moment two options
existed, because a bad draw returns the zero-fee volunteer option and sets the price shown on the
chooser page and the fee written onto every participant. A family could have been registered at
$0.

All four now call `enrollmentOption()` in `lib/events.js`, which selects on `participant_role is
null` — the field that actually means "this option does not decide the role". The generalisable
part: adding a row to a lookup table is a code change wherever the code assumed there would only
ever be one row.

**Still open:** the both-weeks discount (E11) is a different mechanism and a different decision.
That one is a genuine discount on a second registration, and its amount is not yet known — see
Q7 on the reviewer ledger.

---

## 2026-09-01 — Claude runs on a ministry Team organisation; connectors live at organisation level, Vercel excepted

Anthropic approved nonprofit pricing on Claude Team on 1 September 2026. The organisation is owned by
`lawrence@luke14ministries.net`, with `admin@luke14ministries.net` added the same day as a second
owner that holds no seat — the ministry's master key, as on every other vendor, at no cost. Two
seats: Premium ($40, the build seat) and Standard ($8).
Claude Code on the build machine is signed in as the ministry account from today; the platform had
been built on a personal subscription until now, which was a live breach of the ministry-ownership
rule.

**Every Team seat includes Claude Code.** The tiers differ in usage quota, roughly five to one, not
in features. Two documents said Larry's Standard seat would be "without Code" and were corrected.
He needs it: a second web admin who cannot pull, build and push is not a second web admin.

**Connectors are placed at organisation level wherever the vendor allows it.** Stripe, Supabase,
Resend and Microsoft 365 are claude.ai connectors on the organisation, so every seat sees the same
four, each person authorises with their own vendor login, and access is revoked centrally on
offboarding. A local `claude mcp add` was tried first and worked, but it lives in one person's
`~/.claude.json` on one machine — exactly the shape of single-point failure the rest of this log
argues against. The local copies were removed so that Claude does not carry two of every tool.

**Vercel is the exception, and it is Vercel's constraint, not ours.** Its claude.ai connector does
not reach Claude Code, so it is a local plugin (`vercel@claude-plugins-official`) per machine, and it
only works for someone who holds a Vercel seat. On Hobby that is one person. A second admin can still
build and push without it — deploys are triggered by GitHub — but cannot read runtime logs when
production fails. That is the real reason Vercel Pro may need to move from "at go-live" to "now",
and it is a decision for Lawrence and Larry rather than for this log.

*What was given up:* the local Supabase server carried `read_only=true` and a `project_ref` pin, and
the organisation connector carries neither. Read/write was accepted deliberately; the project pin is
a small loss, since the ministry has one Supabase project.

*Alternative considered:* keep everything local, on the grounds that it worked and was already
scoped tightly. Rejected for the reason above — it made Claude's access to five vendors depend on
one laptop.

*Corrected the same day.* Vercel's organisation connector **does** reach Claude Code — it appeared
once the session was restarted, which the first check did not do. So Vercel is not an exception
after all; it lives on the organisation with the other four, and the local plugin is optional and
duplicative. What has not changed: a connector only works for someone the vendor itself recognises,
and on Vercel Hobby that is one person.
