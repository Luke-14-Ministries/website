import PageHero from '@/components/PageHero';
import GivingForm from './GivingForm';
import { asset } from '@/lib/site';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Donate' };

const impacts = [
  'Providing practical resources and ongoing support for families',
  'Hosting inclusive events and celebrations where everyone is welcomed',
  'Running school assemblies in both public and private schools through The Hazelnut Movement Program',
  'Gifting books to educators across the United States through The Hazelnut Movement',
  'Hosting Sunday school classes where we teach kids about disability and help them create superhero capes that remind them every person has a unique gift to share',
  'Training churches to become places of genuine belonging',
  'Equipping volunteers to serve individuals and families affected by disability—both locally and around the world',
];

export default async function DonatePage() {
  // Who is giving? Signed-in donors get their gift saved to their account;
  // guests get a gentle heads-up BEFORE they give, so the choice is theirs.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <PageHero
        image={asset('/images/IMG_6446.jpg')}
        title="Donate"
        subtitle="Giving is a great way to make a difference in the lives of those with disability"
      />

      <section className="container-site py-14">
        <div className="grid gap-10 lg:grid-cols-2 items-start">
          <div>
            <h2 className="text-3xl font-bold mb-6">
              Thank you for considering Luke 14 Ministries with your donation.
            </h2>
            <div className="prose-site">
              <p>
                By making a donation, you are supporting our mission to help
                those impacted by disability find community and connection.
                Your support makes our programs possible and directly impacts
                lives by:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                {impacts.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p>
                Join us in making a difference! Contribute to our General
                Operating Fund or support a specific program like Camp
                Celebrate, Luke 14 Party or The Hazelnut Movement close to your
                heart.
              </p>
              <p>
                If you prefer to make your donation via mail, please use{' '}
                <a
                  href="https://luke14ministries.net/s/Contribution-and-Pledge-PDF-b48z.pdf"
                  target="_blank"
                  rel="noopener"
                  className="text-brand underline"
                >
                  this form
                </a>
                .
              </p>
              <p className="bg-brand-light rounded p-4">
                We also welcome donations of camp supplies for Camp Celebrate,
                medical supplies for our Wheels for Kenya program, and supplies
                for our Luke 14 Party. If you have something you are interested
                in donating, please contact{' '}
                <a
                  href="mailto:darlene@luke14ministries.net"
                  className="text-brand underline"
                >
                  darlene@luke14ministries.net
                </a>{' '}
                to see if we can find a use for your donation!
              </p>
              <p className="text-sm text-neutral-500">
                You can also give through our current PayPal donation page{' '}
                <a
                  href="https://www.paypal.com/donate?hosted_button_id=EJUVCFZ59AU2W"
                  target="_blank"
                  rel="noopener"
                  className="underline"
                >
                  here
                </a>
                .
              </p>
            </div>
          </div>
          <GivingForm signedInEmail={user?.email ?? null} />
        </div>
      </section>
    </>
  );
}
