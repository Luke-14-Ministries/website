import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const metadata = { title: 'Register — Luke 14 Ministries' };

// The neutral front door to registration. Program pages still deep-link
// straight into the right flow (a family tapping "Get Started" on the Camp
// Celebrate page has told us where they're going) -- this page exists for
// everyone who arrives WITHOUT that intent: the dashboard's "register"
// buttons, the empty household page, a bookmark. It answers two questions in
// order: which event, then which door (family/campers vs volunteer).
//
// With one published event this renders a single card, which is fine -- the
// page earns its keep the day event #2 is published, and building it now
// means no flow changes for staff or families when that day comes.

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

  // Published events with at least one published enrollment option. RLS
  // already limits this to published rows, so it is safe logged-out too.
  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, event_options ( id, fee_cents, published )')
    .eq('published', true)
    .order('starts_on', { ascending: true });

  const open = (events ?? [])
    .map((e) => {
      const opt = (e.event_options ?? []).find((o) => o.published);
      return opt ? { ...e, fee: opt.fee_cents } : null;
    })
    .filter(Boolean);

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold text-center">Register</h1>
        <p className="text-center text-neutral-600 mt-3 mb-8">
          Choose the event you&rsquo;re registering for. One account covers your
          whole family, every event, and volunteering.
        </p>

        {open.length === 0 ? (
          <p className="text-center text-neutral-600">
            Registration isn&rsquo;t open just yet. Please check back soon.
          </p>
        ) : (
          <div className="space-y-4">
            {open.map((e) => (
              <div
                key={e.id}
                className="rounded-lg border border-neutral-200 bg-white shadow-sm p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xl font-bold">{e.name}</h2>
                  <p className="text-sm text-neutral-500">
                    {fmtDate(e.starts_on)} &ndash; {fmtDate(e.ends_on)} &middot;{' '}
                    {money(e.fee)}/person
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Link
                    href={`/register/family/?event=${e.id}`}
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
            ))}
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
