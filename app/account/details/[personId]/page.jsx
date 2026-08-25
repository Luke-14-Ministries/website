import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import DetailsForm from './DetailsForm';

export const metadata = { title: 'Support Details — Luke 14 Ministries' };

// The per-person support profile promised at the end of registration:
// "a fuller form — medications, allergy detail, what helps on a hard day,
// emergency contact — appears on your dashboard after you submit."
//
// Access control is row-level security, not a check written here. The
// person_support policy is "this person belongs to a household I am a member
// of", so a parent reaches their own child's profile and nobody else's. The
// only thing this page does is fail cleanly when the query comes back empty,
// which is what RLS returns for someone else's child.
export default async function PersonDetailsPage({ params }) {
  const { personId } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/account/?next=/account/details/${personId}/`);

  const supabase = await createClient();

  // A plain select: if this person is not in the caller's household, RLS
  // returns no row and the page 404s rather than leaking that they exist.
  const { data: person } = await supabase
    .from('people')
    .select('id, first_name, last_name, preferred_name')
    .eq('id', personId)
    .maybeSingle();
  if (!person) notFound();

  const { data: support } = await supabase
    .from('person_support')
    .select('*')
    .eq('person_id', personId)
    .maybeSingle();

  // The photo bucket is private, so a viewable URL is minted here, for this
  // request, by a client that carries this user's own permissions. A leaked
  // path is not a leaked photograph, and the link expires within the hour.
  const { data: photoRow } = await supabase
    .from('person_photos')
    .select('storage_path')
    .eq('person_id', personId)
    .maybeSingle();

  let photoUrl = null;
  if (photoRow?.storage_path) {
    const { data: signed } = await supabase.storage
      .from('person-photos')
      .createSignedUrl(photoRow.storage_path, 3600);
    photoUrl = signed?.signedUrl ?? null;
  }

  // What role(s) this person actually holds on live registrations. The form
  // uses it to decide how much to ask up front (25 Aug): a camper gets the
  // full support profile, everyone else gets the short version they can
  // expand. Read from participants rather than guessed from age — a sibling
  // may have as much need as a camper, and a volunteer may have none.
  const { data: roleRows } = await supabase
    .from('registration_participants')
    .select('camp_role, status')
    .eq('person_id', personId);
  const liveRoles = (roleRows ?? [])
    .filter((r) => r.status !== 'cancelled')
    .map((r) => r.camp_role);
  // Anyone who is a camper ANYWHERE gets the full form. Erring toward asking
  // is the safe direction with medical detail.
  const isCamper = liveRoles.includes('camper');

  const name = person.preferred_name || person.first_name;

  return (
    <section className="bg-neutral-50 py-12">
      <div className="container-site max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-center">
          Support details for {name}
        </h1>
        <p className="text-center text-neutral-600 mt-3 mb-2">
          This is the fuller form we mentioned when you registered. It helps camp staff
          look after {name} well — and it is how a week goes right rather than nearly
          right.
        </p>
        <p className="text-center text-sm mb-8">
          <Link href="/account/dashboard/" className="text-brand underline font-semibold">
            &larr; Back to my dashboard
          </Link>
        </p>

        <DetailsForm
          person={person}
          support={support}
          photoUrl={photoUrl}
          isCamper={isCamper}
          roles={liveRoles}
        />
      </div>
    </section>
  );
}
