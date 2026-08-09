import ResetPasswordForm from './ResetPasswordForm';

export const metadata = { title: 'Set a New Password' };

// Reached from the link in a password-reset email, which passes through
// app/auth/callback/route.js first. By the time anyone sees this page they are
// signed in -- middleware turns away anyone who is not.
export default function ResetPasswordPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8">New Password</h1>
        <ResetPasswordForm />
      </div>
    </section>
  );
}
