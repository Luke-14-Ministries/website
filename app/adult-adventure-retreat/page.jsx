import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Adult Adventure Retreat' };

// Dates corrected 23 Aug 2026. This page said "October 23-26" -- last year's
// dates, carried over with last year's banner artwork. The ministry's live
// page and the event record in the database both say 29 October to
// 1 November. A wrong date on a public page is worse than a missing one.
//
// The banner uses variant="banner" because it is a designed graphic with its
// own words in it; the default cropping hero was cutting off the top and the
// bottom of the artwork. NOTE: the artwork itself is still last season's file
// (it reads OCT 23-26TH). The ministry's live site has a newer version --
// "Adult Adventure (Website Banner) (3).png" -- which needs to be saved into
// public/images and pointed at here.
export default function AdultAdventureRetreatPage() {
  return (
    <>
      <PageHero
        variant="banner"
        image={asset('/images/Adult_Adventure__28Website_Banner_29.jpg')}
        title="Adult Adventure Retreat"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl sm:text-3xl font-bold leading-snug">
          A weekend of adventure, worship, and community for independent adults
          with disabilities&mdash;October 29 to November 1 in the beautiful
          mountains near Gatlinburg, TN.
        </h2>
        <p className="mt-5 text-lg text-neutral-700">
          $480 per person &middot; arrival 6:00 PM Thursday, October 29 &middot;
          limited to 30 participants.
        </p>
        <div className="mt-10">
          <Link
            href="/account/signup/?next=/register/family/%3Fprogram%3DAdult%2520Adventure%2520Retreat%25202026"
            className="btn-primary !px-8"
          >
            Register for the Retreat
          </Link>
          <p className="mt-4 text-neutral-600">
            Been before?{' '}
            <Link
              href="/account/?next=/register/family/%3Fprogram%3DAdult%2520Adventure%2520Retreat%25202026"
              className="text-brand underline font-semibold"
            >
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
              The Adult Adventure Retreat is a weekend getaway in the
              beautiful mountains near Gatlinburg, Tennessee, specifically
              designed for independent young adults with disabilities. Hosted
              by Luke 14 Ministries, this retreat offers a unique opportunity
              to connect with peers, engage in worship, and enjoy fun
              activities in a supportive environment.
            </p>
            <p>
              Each participant will be paired with a trained buddy, ensuring a
              safe and memorable experience throughout the weekend. With a
              limited capacity of 30 participants, early registration is
              encouraged to secure your spot.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
