import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata = { title: 'Forgot Password' };

export default function ForgotPasswordPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8">Forgot Password</h1>
        <ForgotPasswordForm />
      </div>
    </section>
  );
}
