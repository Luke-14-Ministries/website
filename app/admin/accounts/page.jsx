import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import AccountsManager from './AccountsManager';

export const metadata = { title: 'Accounts — Staff Admin' };

// Every login on the platform -- families and staff alike -- with the account
// facts that do not live anywhere else: when it was created, when it last
// signed in, whether the email is confirmed, whether two-factor is on.
//
// The data comes from admin_list_accounts() (migration 0022), a SECURITY
// DEFINER function that re-checks is_admin() server-side. auth.users is not
// reachable any other way, which is the point: the page is a convenience, the
// function is the boundary.
export default async function AccountsPage() {
  const staff = await getStaff();
  if (!can(staff, 'admin')) redirect('/admin/');

  const supabase = await createClient();
  const [{ data: accounts, error }, { data: households }, { data: unclaimedPeople }] =
    await Promise.all([
      supabase.rpc('admin_list_accounts'),
      // For the "Link to household" picker. Staff RLS on households already
      // allows this read; sorted so the dropdown is scannable.
      supabase
        .from('households')
        .select('id, display_name, city')
        .order('display_name'),
      // People no login has claimed as "this is me" -- the optional second
      // dropdown in the link modal. Children are filtered out client-side
      // (a login always belongs to an adult), but fetching them all keeps
      // this one simple query.
      supabase
        .from('people')
        .select('id, household_id, first_name, last_name, date_of_birth')
        .is('profile_id', null)
        .order('last_name'),
    ]);

  if (error) {
    console.error('admin_list_accounts:', error.message);
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-6">
      <h1 className="text-2xl font-bold mb-1">Accounts</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Every login on the platform. Removing a login never deletes a
        family&rsquo;s registrations or payments &mdash; that takes the
        separate &ldquo;delete family &amp; data&rdquo; action, which spells
        out what it is about to remove. The amber count on the nav is simply
        accounts created in the last 7 days &mdash; awareness, not a review
        queue; each one drops off as it turns a week old. The &ldquo;New this
        week&rdquo; filter below shows exactly those.
      </p>
      <AccountsManager
        accounts={accounts ?? []}
        households={households ?? []}
        unclaimedPeople={unclaimedPeople ?? []}
        selfId={staff.userId}
        loadError={Boolean(error)}
      />
    </div>
  );
}
