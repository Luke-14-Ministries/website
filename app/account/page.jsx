import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LoginForm from './LoginForm';

export const metadata = { title: 'My Account' };

// This is the login page -- but "My Account" in the site nav points here, and a
// signed-in person clicking it should land on their dashboard, not be shown a
// login form they don't need. So if there's already a valid session, send them
// on: to wherever they were headed (?next=, when middleware bounced them here)
// or to the dashboard. Only a genuinely logged-out visitor sees the form.
export default async function AccountPage({ searchParams }) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const rawNext = typeof params?.next === 'string' ? params.next : '';
    const dest =
      rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
        ? rawNext
        : '/account/dashboard/';
    redirect(dest);
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8">My Account</h1>
        {/* The Suspense boundary is required, not decorative: LoginForm reads
            the ?next= query string, and Next.js refuses to prerender a page
            that does that without one. */}
        <Suspense fallback={<div className="h-96 rounded-lg bg-white/60" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-neutral-600 text-sm">
          One account for everything: register your family or volunteer for
          Camp Celebrate, manage your registrations, and view or update your
          giving.
        </p>
      </div>
    </section>
  );
}
