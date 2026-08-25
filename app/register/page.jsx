import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { programOf, registrationOpen, OPEN_EVENT_COLUMNS } from '@/lib/events';

export const metadata = { title: 'Register — Luke 14 Ministries' };

// The neutral front door to registration. Program pages still deep-link
// straight into the right flow -- this page exists for everyone who arrives
// WITHOUT that intent: the dashboard's "register" buttons, the empty
// household page, a bookmark.
//
// One card per PROGRAM (Camp Celebrate, the Retreat, ...), not per session --
// a family choosing "Camp Celebrate" here and their week inside the wizard is
// one decision each. Listing every week here AND asking again at step 3 was
// the redundancy this replaced. Only programs with at least one OPEN event
// appear; the ministry opens and closes registration per event on the admin
// Setup page.

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const money = (cents) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

export default async function RegisterPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select(OPEN_EVENT_COLUMNS)
    .eq('published', true)
    .order('starts_on', { ascending: true });

  const open = (events ?? []).filter((e) => registrationOpen(e));

  // Group sessions into programs: "Camp Celebrate 2027 — Week 1/2" becomes one
  // "Camp Celebrate 2027" card spanning both weeks.
  const programs = [];
  for (const e of open) {
    const key = programOf(e.name);
    let p = programs.find((x) => x.key === key);
    if (!p) {
      p = { key, events: [] };
      programs.push(p);
    }
    p.events.push(e);
  }

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold text-center">Register</h1>
        <p className="text-center text-neutral-600 mt-3 mb-8">
          Choose what you&rsquo;re registering for. One account covers your
          whole family, every event, and volunteering.
        </p>

        {programs.length === 0 ? (
          <p className="text-center text-neutral-600">
            Registration isn&rsquo;t open just yet. Please check back soon.
          </p>
        ) : (
          <div className="space-y-4">
            {programs.map((p) => {
              const starts = p.events.map((e) => e.starts_on).sort()[0];
              const ends = p.events.map((e) => e.ends_on).sort().slice(-1)[0];
              const fees = [
                ...new Set(
                  p.events.map(
                    (e) => (e.event_options ?? []).find((o) => o.published)?.fee_cents
                  )
                ),
              ];
              return (
                <div
                  key={p.key}
                  className="rounded-lg border border-neutral-200 bg-white shadow-sm p-6"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-xl font-bold">{p.key}</h2>
                    <p className="text-sm text-neutral-500">
                      {fmtDate(starts)} &ndash; {fmtDate(ends)} &middot;{' '}
                      {fees.length === 1
                        ? `${money(fees[0])}/person`
                        : `from ${money(Math.min(...fees))}/person`}
                    </p>
                  </div>
                  {p.events.length > 1 && (
                    <p className="mt-1 text-sm text-neutral-600">
                      {p.events.length} sessions — you&rsquo;ll pick yours during
                      registration.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Link
                      href={`/register/family/?program=${encodeURIComponent(p.key)}`}
                      className="btn-primary !py-2"
                    >
                      Register your family
                    </Link>
                    <p className="text-sm text-neutral-600">
                      Want to serve instead?{' '}
                      <Link
                        href="/register/volunteer/"
                        className="text-brand underline font-semibold"
                      >
                        Volunteer
                      </Link>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-sm text-neutral-600">
          {user ? (
            <Link
              href="/account/dashboard/"
              className="text-brand underline font-semibold"
            >
              &larr; Back to my dashboard
            </Link>
          ) : (
            <>
              Already have an account?{' '}
              <Link
                href="/account/?next=%2Fregister%2F"
                className="text-brand underline font-semibold"
              >
                Log in
              </Link>{' '}
              &mdash; you&rsquo;ll come straight back here.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
