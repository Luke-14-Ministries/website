import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import PrintButton from './PrintButton';

export const metadata = { title: 'My Agreements — Luke 14 Ministries' };

// A family's copy of what they signed.
//
// Two reasons this page exists rather than a download link. First, it is
// standard practice for an electronic signature to be accompanied by the
// ability to retain a copy of what was agreed to -- a checkbox with no record
// behind it is weak evidence for the ministry as well as unfair to the family.
// Second, our agreements are versioned by key + version and signatures point at
// the specific row, so we can show the EXACT text someone agreed to years
// later, even after the board revises the wording. "You agreed to the 2026
// forms" is not the same claim.
//
// Saving a copy is the browser's print-to-PDF, which every phone and desktop
// has, rather than a generated file we would then have to store and secure.

const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const SIGNER_ROLE_LABEL = {
  self: 'for themselves',
  parent: 'as a parent',
  guardian: 'as a legal guardian',
  account_holder: 'as the account holder',
};

const CONSENT_LABEL = {
  media: 'Photos and video — may be featured in published material',
  directory: 'Included in the participant directory',
};

export default async function AgreementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/agreements/');

  const supabase = await createClient();
  const { data: memberRows } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id)
    .limit(1);
  const householdId = memberRows?.[0]?.household_id;

  let signatures = [];
  let consents = [];
  let queryError = null;

  if (householdId) {
    // Standing rule on this project: never swallow a query error. A blank page
    // where a signature should be is exactly the kind of thing someone would
    // read as "we never signed anything".
    const [sigRes, conRes] = await Promise.all([
      supabase
        .from('agreement_signatures')
        .select(
          `id, signed_at, signer_name, signer_role, status,
           agreements ( key, version, title, body ),
           registrations ( events ( name ) )`
        )
        .eq('household_id', householdId)
        .order('signed_at', { ascending: false }),
      supabase
        .from('person_consents')
        .select('id, kind, granted, recorded_at, people!inner ( id, first_name, last_name, household_id )')
        .eq('people.household_id', householdId)
        .order('recorded_at', { ascending: false }),
    ]);
    signatures = sigRes.data ?? [];
    consents = conRes.data ?? [];
    queryError = sigRes.error?.message || conRes.error?.message || null;
  }

  // Group signatures by the event they were signed for, newest first. A family
  // that has attended three years running should see three clean blocks, not
  // eighteen rows.
  const byEvent = new Map();
  for (const s of signatures) {
    const name = s.registrations?.events?.name ?? 'General';
    if (!byEvent.has(name)) byEvent.set(name, []);
    byEvent.get(name).push(s);
  }

  // Latest answer per person per kind -- the current permission. Earlier rows
  // are history and stay in the database, but showing a family a withdrawn
  // "yes" alongside their "no" would only confuse.
  const currentConsents = [];
  const seenConsent = new Set();
  for (const c of consents) {
    const k = `${c.people?.id}:${c.kind}`;
    if (seenConsent.has(k)) continue;
    seenConsent.add(k);
    currentConsents.push(c);
  }

  return (
    <section className="bg-neutral-50 py-12 print:bg-white print:py-0">
      <div className="container-site max-w-3xl mx-auto">
        <div className="print:hidden">
          <h1 className="text-4xl font-bold text-center">My Agreements</h1>
          <p className="text-center text-neutral-600 mt-3">
            Everything you have signed, with the exact wording you agreed to.
          </p>
          <div className="mt-6 mb-8 flex flex-wrap justify-center gap-4">
            <Link href="/account/dashboard/" className="btn-outline !py-2">
              &larr; Back to my dashboard
            </Link>
            {signatures.length > 0 && <PrintButton />}
          </div>
        </div>

        {/* Only visible on paper / in the PDF. */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold">Luke 14 Ministries — Signed Agreements</h1>
          <p className="text-sm text-neutral-600">Account: {user.email}</p>
        </div>

        {queryError && (
          <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
            We couldn&rsquo;t load your agreements: {queryError}
          </p>
        )}

        {!householdId || signatures.length === 0 ? (
          <p className="text-center text-neutral-600">
            You haven&rsquo;t signed anything yet. Agreements are presented as part of
            registration, and your signed copy appears here afterwards.
          </p>
        ) : (
          <div className="space-y-8">
            {[...byEvent.entries()].map(([eventName, rows]) => (
              <div
                key={eventName}
                className="rounded-lg border border-neutral-200 bg-white shadow-sm p-6 sm:p-8 print:border-0 print:shadow-none print:p-0"
              >
                <h2 className="text-xl font-bold">{eventName}</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Signed by <strong>{rows[0].signer_name}</strong>{' '}
                  {SIGNER_ROLE_LABEL[rows[0].signer_role] ?? ''} on{' '}
                  {fmtDateTime(rows[0].signed_at)}.
                </p>
                <div className="mt-4 space-y-4">
                  {rows.map((s) => (
                    <div key={s.id} className="rounded border border-neutral-200 p-4">
                      <p className="font-bold">
                        {s.agreements?.title}{' '}
                        <span className="font-normal text-xs text-neutral-500">
                          (version {s.agreements?.version})
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-neutral-700">{s.agreements?.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {currentConsents.length > 0 && (
          <div className="mt-8 rounded-lg border border-neutral-200 bg-white shadow-sm p-6 sm:p-8 print:border-0 print:shadow-none print:p-0">
            <h2 className="text-xl font-bold">Permissions</h2>
            <p className="mt-1 text-sm text-neutral-600">
              These are choices, not agreements — you can change either one at any
              time, and doing so changes nothing else about your registration.
            </p>
            <ul className="mt-4 space-y-2">
              {currentConsents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold">
                    {c.people?.first_name} {c.people?.last_name}
                  </span>
                  <span className="text-neutral-600">— {CONSENT_LABEL[c.kind] ?? c.kind}:</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      c.granted ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-neutral-700'
                    }`}
                  >
                    {c.granted ? 'Yes' : 'No'}
                  </span>
                  <span className="text-xs text-neutral-400">
                    recorded {new Date(c.recorded_at).toLocaleDateString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-neutral-500 print:hidden">
              To change one, open your registration and update the person&rsquo;s
              answer, or contact camp staff. We keep the history of what was
              permitted when, because published material outlives the permission
              that allowed it. If a particular photo ever concerns you, email{' '}
              <span className="font-semibold">info@luke14ministries.net</span> — we
              can&rsquo;t promise nobody appears in a wide group shot, but we will work
              to address a specific request promptly.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
