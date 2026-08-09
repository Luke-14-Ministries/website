# Database migrations

Plain SQL files. Each one is a step that moves the database from one shape to the next.
They are numbered, and the number is the order they run in — `0001` before `0002`, always.

## How to run one

1. Open the Supabase dashboard for the project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open the migration file in a text editor, copy the whole thing, paste it in.
4. Press **Run**.

That is the entire workflow. There is no build step, no CLI to install, and nothing to
remember between sessions. It was chosen over the Supabase CLI for exactly that reason: a
volunteer who has not touched this in four months can still do it.

## The one rule

**Never edit a migration after it has been run.** The file is a historical record of what
was actually done to the database, not a description of what we wish the database looked
like. If `0001` was run last month and we now want a new column, that is a new file —
`0002_add_whatever.sql` — not a change to `0001`.

Breaking this rule means the file on disk no longer matches the database it was run
against, and nobody can tell what state a fresh database will end up in.

## What is here

| File | What it does |
|---|---|
| `0001_core_schema.sql` | The whole Phase 1 schema: households, people, support needs, seasons and sessions, registrations, volunteer applications and clearances, agreements and signatures, payments. Enables row-level security on every table and writes the policies. |
| `rls_test.sql` | Not a migration. A proof harness — see below. |

## `rls_test.sql`

A migration that runs without error proves the syntax was valid. It proves nothing at all
about whether the security policies actually keep one family's data away from another
family. Those are different questions, and only the second one matters.

So `rls_test.sql` seeds four made-up people — two parents in two different households, a
registrar, and a stranger who belongs to nowhere — and then checks, forty-two times, that
each of them can see exactly what they should and nothing else. If any check fails the
script raises an error and stops.

It is **not** run against the real Supabase project. It is a test fixture: it creates fake
users and fake registrations, and it is meant for a throwaway local Postgres. Running it
against production would put junk data in the database.

It is kept in the repository because the next person to change a policy needs a way to find
out whether they broke something. Change a policy, run the harness against a scratch
database, see whether all forty-two still pass.

The first time this harness was run it caught a real hole: families could read the staff-only
notes on their own registration. Column-level permissions in Postgres do not work the way
they appear to — a table-level `grant select` covers every column, and a column-level
`revoke` does not take it back. The fix was to move staff notes into their own table.
That bug would have shipped silently.
