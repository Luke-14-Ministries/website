import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getStaff } from '@/lib/staff';
import SecurityManager from './SecurityManager';

export const metadata = { title: 'Security' };

// Manage two-factor for your own account. Optional for families, required for
// staff -- when ?required=1 is present (staff sent here by the admin gate) the
// manager shows the "you must turn this on" note.
export default async function SecurityPage({ searchParams }) {
  const params = await searchParams;
  const required = params?.required === '1';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/account/?next=/account/security/');

  const staff = await getStaff();

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-lg mx-auto">
        <div className="mb-6">
          <Link href="/account/dashboard/" className="text-sm text-brand underline">
            ← Back to my account
          </Link>
        </div>
        <SecurityManager required={required || Boolean(staff)} />
      </div>
    </section>
  );
}
