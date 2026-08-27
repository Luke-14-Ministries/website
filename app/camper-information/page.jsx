import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Camper Information' };

const whatToBring = [
  'Beach towels',
  'Money for camp store (if you would like)',
  'Bible, notebook, pen',
  'Bug spray, sunscreen',
  'Casual, comfortable clothing',
  'Shoes comfortable for walking around camp',
  'Water shoes (for whitewater rafting)',
  'Modest, full coverage bathing suit',
  'Toiletries and other personal items',
  'Jacket',
  'Camping chair(s) with your name on them',
  'Camera',
  'Special food or medical equipment needed',
  'Medication',
];

export default function CamperInformationPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0834.jpg')}
        title="Camper Information"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold">
          Camp Celebrate 2027 early registration is now OPEN!
        </h2>
        <div className="prose-site mt-6">
          <p>
            Register in the month of September and get $45 off each camper and
            volunteer tuition when you sign up for a payment plan.
          </p>
          <p>
            New to Camp Celebrate and need a registration account? Click here
            to get started and register
          </p>
        </div>
        <Link href="/account/signup/?next=/register/family/" className="btn-primary mt-6 inline-block">
          Get Started
        </Link>
        <p className="mt-6 text-neutral-600">
          Already have an account?{' '}
          <Link href="/account/?next=/register/family/" className="text-brand underline font-semibold">
            Log in and register
          </Link>
          . Volunteering? Start at the{' '}
          <Link href="/register/volunteer" className="text-brand underline font-semibold">
            volunteer page
          </Link>
          .
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/20210720_195424.jpg')}
          alt="Camp Celebrate"
          className="mt-12 rounded-lg shadow w-full"
        />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">Location, Dates, Schedule</h2>
          <div className="prose-site">
            <p>
              <a
                href="https://web.archive.org/web/20180826150855/http://www.tnbaptist.org/carson/"
                target="_blank"
                rel="noopener"
                className="text-brand font-semibold underline"
              >
                Carson Springs Baptist Conference Center in Newport, TN
              </a>
            </p>
            <p>
              2027 Dates:
              <br />
              July 19 - 23 and
              <br />
              July 26 - July 30
            </p>
            <p>
              Campers arrive on Monday afternoon each week and depart before
              lunch on Friday.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0945.jpg')}
            alt="Camp Celebrate"
            className="mt-10 rounded-lg shadow w-full"
          />
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">Cost</h2>
        <p className="text-4xl font-bold text-brand mb-6">$495</p>
        <div className="prose-site">
          <p>
            The rooms for families are hotel-style rooms with 2 double beds
            each (limited number of rollaways available). If you will need a
            second room, please contact us at{' '}
            <a
              href="mailto:registration@luke14ministries.net"
              className="text-brand font-semibold underline"
            >
              registration@luke14ministries.net
            </a>{' '}
            to discuss your specific situation.
          </p>
          <p>
            <em>
              Please <strong>do not</strong> let the cost keep you from
              inquiring about attending camp. Please go ahead and register or
              reach out to{' '}
              <a
                href="mailto:registration@luke14ministries.net"
                className="text-brand font-semibold underline"
              >
                registration@luke14ministries.net
              </a>{' '}
              if you have a question about scholarship money.
            </em>
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/20210721_140401.jpg')}
          alt="Camp Celebrate"
          className="mt-10 rounded-lg shadow w-full"
        />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">What to Expect</h2>
          <div className="prose-site">
            <p>
              You can expect lots of time to enjoy activities as a family,
              teaching and worship times as a large group, free time to spend
              while your children are well cared for, refreshing and
              encouraging time with other men and women who have walked a road
              similar to yours, fun, safe and age appropriate programs for each
              camper attending, and so much more!
            </p>
            <p>
              There will be a buddy assigned to your family member who has a
              disability. They will be there to help you, get to know you all
              and give your camper the best Family Retreat possible! (They
              cannot help with personal needs, so you&rsquo;ll set meeting
              times and places to take care of those needs.)
            </p>
            <p>
              Carson Springs Baptist Conference Center has beautiful
              hotel-style accommodations, and the dining hall is in the same
              building for quick and easy access.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0060.jpg')}
            alt="Camp Celebrate"
            className="mt-10 rounded-lg shadow w-full"
          />
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">What to Bring</h2>
        <ul className="list-disc pl-6 space-y-2 text-lg text-neutral-700">
          {whatToBring.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
