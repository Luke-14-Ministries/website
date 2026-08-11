import { Suspense } from 'react';
import SignupForm from './SignupForm';

export const metadata = { title: 'Create Account' };

export default function SignupPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-lg mx-auto">
        <h1 className="text-4xl font-bold text-center mb-3">
          Create Your Account
        </h1>
        <p className="text-center text-neutral-600 mb-8">
          One account for camp registration and giving — for both families and
          volunteers.
        </p>
        {/* Suspense is required, not decorative: SignupForm reads the ?next=
            query string, and Next.js refuses to prerender a page that does that
            without a boundary. Same pattern as app/account/page.jsx. */}
        <Suspense fallback={<div className="h-96 rounded-lg bg-white/60" />}>
          <SignupForm />
        </Suspense>
      </div>
    </section>
  );
}
