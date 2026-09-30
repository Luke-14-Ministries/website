# Payment-plan tests (scratch database only)

These are checks, not migrations. **Never run them against the real Supabase project**:
they create fake families and payments.

They were written 30 September 2026 alongside migration `0080` and the payment-plan
functions, and they caught a real bug before it shipped. A second or third failed
charge was not recorded as a failure, so the plan never stopped and the charge would
have been retried every day.

## What is here

| File | What it checks |
|---|---|
| `supabase_stubs.sql` | Stand-ins for Supabase's `auth.uid()`, roles and storage, so the migrations run on plain Postgres. |
| `payment_plans_seed.sql` | One family (a camper, and a parent who is also volunteering), one registrar, one camp week. |
| `payment_plans_rules.sql` | The database rules: a family cannot change a fee, the early discount (paid in full, plan, failed payment, staff removing it, late registrants, the cap), charge dates, and who may do what. Rows named `expect_…` show the value they should equal; `PASS`/`FAIL` notices are checked automatically. |
| `payment_plans_e2e.ts` | The real webhook and charger code (`functions/_shared/`) against the scratch database, with a stand-in for Stripe. It covers the deposit activating a plan, a dry run, card charges, repeated Stripe events, declines and retries, the plan stopping after three failures, a new bank account restarting it, a bank transfer clearing, a scholarship partway through, and the last charge landing on $0. It ends `ALL PASSED` or exits non-zero. |

## How to run them (Linux or WSL)

1. Start a throwaway Postgres 16, create a database called `t2`, and run
   `supabase_stubs.sql` against it. Then run every `migrations/0*.sql` in order, then
   `payment_plans_seed.sql`.
2. **Rules:** `psql -d t2 -f payment_plans_rules.sql`. Look for `FAIL` or an error.
3. **End to end:** run PostgREST v12 against `t2`, with `authenticator` as the login role
   and `anon`, `authenticated` and `service_role` granted to it, on port 3399. Put a
   service-role JWT (HS256, `{"role":"service_role"}`, signed with PostgREST's
   `jwt-secret`) in `/var/tmp/srv.jwt`. Then `deno run --allow-all payment_plans_e2e.ts`.
   Rebuild `t2` from scratch before each run: the test changes the data it runs on.
