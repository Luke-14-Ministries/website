import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = { title: 'My Account' };

export default function AccountPage() {
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
