import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ContactManager from './ContactManager';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'My Contact Info & Preferences — Luke 14 Ministries' };

// The person's own account details: name, personal phone, login email, and
// email preferences. Family/household contact info (the address and phone camp
// uses) lives under Manage Household -- this page links there.
export default async function ContactPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/contact/');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone, sms_opt_in, email_news')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold">My Contact Info &amp; Preferences</h1>
          <BackLink />
        </div>
        <p className="text-neutral-600 mb-8">
          These are your own account details. Your family&rsquo;s shared contact info — the
          household phone and address camp uses — lives under{' '}
          <Link href="/account/household/" className="text-brand font-semibold">
            Manage Household
          </Link>
          .
        </p>

        <ContactManager
          email={user.email}
          profile={{
            first_name: profile?.first_name ?? '',
            last_name: profile?.last_name ?? '',
            phone: profile?.phone ?? '',
            sms_opt_in: profile?.sms_opt_in === true,
            email_news: profile?.email_news !== false,
          }}
        />
      </div>
    </section>
  );
}
