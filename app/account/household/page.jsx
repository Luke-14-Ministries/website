import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import HouseholdManager from './HouseholdManager';

export const metadata = { title: 'Manage Household — Luke 14 Ministries' };

const ageFrom = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a -= 1;
  return a;
};

// Family-side household management: contact info, each person's details (with
// a phone per adult), and each person's two linked caregivers. RLS scopes
// everything to the family's own household.
export default async function ManageHouseholdPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/household/');

  const supabase = await createClient();
  const { data: memberRows } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  const householdId = memberRows?.[0]?.household_id;

  if (!householdId) {
    return (
      <section className="bg-neutral-50 py-12 min-h-[60vh]">
        <div className="container-site max-w-xl mx-auto text-center">
          <h1 className="text-3xl font-bold">Manage Household</h1>
          <p className="mt-4 text-neutral-700">
            No household on file yet — one is created the first time you register.
          </p>
          <Link href="/register/" className="btn-primary mt-6 inline-block">
            Register for an Event
          </Link>
          <p className="mt-4 text-sm">
            <Link href="/account/dashboard/" className="text-brand underline font-semibold">
              &larr; Back to my dashboard
            </Link>
          </p>
        </div>
      </section>
    );
  }

  const [{ data: household }, { data: people }, { data: careLinks }, { data: guardianRoles }] =
    await Promise.all([
      supabase
        .from('households')
        .select('id, display_name, email, phone, address_line1, city, state, postal_code')
        .eq('id', householdId)
        .maybeSingle(),
      supabase
        .from('people')
        .select('id, first_name, last_name, date_of_birth, gender, phone, email')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase.from('person_caregivers').select('person_id, caregiver_person_id, position'),
      supabase
        .from('registration_participants')
        .select('camp_role, people!inner ( id, household_id )')
        .eq('people.household_id', householdId)
        .eq('camp_role', 'parent_guardian'),
    ]);

  const guardianIds = new Set((guardianRoles ?? []).map((g) => g.people?.id).filter(Boolean));
  const members = (people ?? []).map((p) => ({
    ...p,
    age: ageFrom(p.date_of_birth),
    isGuardian: guardianIds.has(p.id),
  }));

  const caregiversByPerson = {};
  for (const link of careLinks ?? []) {
    if (!caregiversByPerson[link.person_id]) caregiversByPerson[link.person_id] = {};
    caregiversByPerson[link.person_id][link.position] = link.caregiver_person_id;
  }

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-3xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold">Manage Household</h1>
          <Link href="/account/dashboard/" className="text-brand font-semibold text-sm">
            ← Back to dashboard
          </Link>
        </div>
        <p className="text-neutral-600 mb-8">
          Keep your family&rsquo;s details current — camp staff see whatever is saved here. Each
          person can have up to two linked caregivers; we suggest the parents/guardians in your
          household, but you can change them.
        </p>

        <HouseholdManager
          household={household}
          members={members}
          caregiversByPerson={caregiversByPerson}
        />
      </div>
    </section>
  );
}
