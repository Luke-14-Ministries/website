import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard' };

// This is a server component -- no 'use client' -- so the database call below
// happens on the server and the anon key never has to be trusted with anything
// it should not see. Row-level security decides what comes back: the
// profiles_select_self policy in 0001_core_schema.sql means this query can only
// ever return the logged-in person's own row, whatever the query asks for.
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects anonymous visitors away from this path. This
  // check is here anyway: middleware is a convenience, and a page that assumes
  // a user exists will crash rather than redirect if the matcher is ever
  // edited. Two lines to make that impossible.
  if (!user) redirect('/account/?next=/account/dashboard/');

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();

  // maybeSingle rather than single: a profile row is created by a database
  // trigger the moment the account is created, but if that trigger is ever
  // missing, single() throws and the whole page 500s. Falling back to the
  // email address degrades quietly instead.
  const greeting =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    user.email;

  return (
    <section className="bg-neutral-50 min-h-[70vh] py-12">
      <div className="container-site">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Welcome back, {greeting}!</h1>
            <p className="text-neutral-500">
              Signed in as {user.email}
            </p>
          </div>
          {/* A form, not a link. See app/auth/signout/route.js for why. */}
          <form action="/auth/signout/" method="post">
            <button type="submit" className="btn-outline !py-2">
              Log Out
            </button>
          </form>
        </div>

        <div className="mb-8 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <strong>Sample content.</strong> Your login is real, but the
          registrations, household and giving history below are placeholders
          while the rest of the system is built. Nothing here reflects your
          actual account yet.
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4">My Camp Registrations</h2>
            <div className="rounded border border-neutral-200 p-4 flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Camp Celebrate 2026 — Week 2 (July 27–31)
                </p>
                <p className="text-neutral-600 text-sm">
                  4 family members · Balance due: $245 of $495
                </p>
              </div>
              <span className="self-center rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-sm font-semibold">
                Deposit Paid
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn-primary !py-2">Pay Balance</button>
              <button className="btn-outline !py-2">Edit Registration</button>
              <Link href="/register/family" className="btn-outline !py-2">
                New Registration
              </Link>
            </div>
          </div>

          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
            <h2 className="text-xl font-bold mb-4">My Household</h2>
            <ul className="space-y-2 text-neutral-700">
              <li>Jane Sample — Parent/Guardian</li>
              <li>John Sample — Parent/Guardian</li>
              <li>Alex Sample — Camper (14)</li>
              <li>Riley Sample — Sibling (11)</li>
            </ul>
            <button className="btn-outline !py-2 mt-4 w-full">
              Manage Household
            </button>
          </div>

          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4">My Giving</h2>
            <table className="w-full text-left">
              <thead>
                <tr className="text-sm text-neutral-500 border-b">
                  <th className="py-2">Date</th>
                  <th>Fund</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700">
                <tr className="border-b">
                  <td className="py-2">Jun 1, 2026</td>
                  <td>Camp Celebrate</td>
                  <td>Monthly</td>
                  <td className="text-right">$50.00</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">May 1, 2026</td>
                  <td>Camp Celebrate</td>
                  <td>Monthly</td>
                  <td className="text-right">$50.00</td>
                </tr>
                <tr>
                  <td className="py-2">Mar 14, 2026</td>
                  <td>General Operating Fund</td>
                  <td>One-time</td>
                  <td className="text-right">$100.00</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="btn-outline !py-2">
                Manage Recurring Gift
              </button>
              <button className="btn-outline !py-2">
                Download Giving Statement
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
            <h2 className="text-xl font-bold mb-4">Account Settings</h2>
            <ul className="space-y-2 text-neutral-700">
              <li className="text-neutral-400">Update contact information</li>
              <li>
                <Link
                  href="/account/reset-password"
                  className="text-brand underline"
                >
                  Change password
                </Link>
              </li>
              <li className="text-neutral-400">Email preferences</li>
              <li className="text-neutral-400">Payment methods</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
