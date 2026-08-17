import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Adult Adventure Retreat' };

export default function AdultAdventureRetreatPage() {
  return (
    <>
      <PageHero
        image={asset('/images/Adult_Adventure__28Website_Banner_29.jpg')}
        title="Adult Adventure Retreat"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl sm:text-3xl font-bold leading-snug">
          A weekend of adventure, worship, and community for independent adults
          with disabilities&mdash;October 23&ndash;26 in the beautiful
          mountains near Gatlinburg, TN.
        </h2>
        <div className="mt-10">
          <Link href="/account/signup/?next=/register/family/" className="btn-primary !px-8">
            Register for the Retreat
          </Link>
          <p className="mt-4 text-neutral-600">
            Been before?{' '}
            <Link href="/account/?next=/register/family/" className="text-brand underline font-semibold">
              Log in and register
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">
            What is the Adult Adventure Retreat
          </h2>
          <div className="prose-site">
            <p>
              The Adults Adventure Retreat is a weekend getaway in the
              beautiful mountains near Gatlinburg, Tennessee, specifically
              designed for independent young adults with disabilities. Hosted
              by Luke 14 Ministries, this retreat offers a unique opportunity
              to connect with peers, engage in worship, and enjoy fun
              activities in a supportive environment.
            </p>
            <p>
              Each participant will be paired with a trained buddy, ensuring a
              safe and memorable experience throughout the weekend. With a
              limited capacity of 30 campers, early registration is encouraged
              to secure your spot.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
