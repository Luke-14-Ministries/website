import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Volunteer (STM) Information' };

const whatToBring = [
  'Beach towels',
  'Money for camp store (if you would like)',
  'Bible, notebook, pen',
  'Bug spray, sunscreen',
  'Casual, comfortable clothing (please make modest clothing choices avoiding skinny strap tank tops, short shorts and skirts)',
  'Shoes comfortable for doing a lot of walking around camp',
  'Water shoes (for whitewater rafting)',
  'Modest, full coverage bathing suit',
  'Toiletries and other personal items',
  'Jacket',
  'Camping chair(s) with your name on them',
  'Special food or medical equipment needed',
  'Medication',
  'Pillow',
  'Sleeping bag or linens for twin bunk',
  'Towel for showering',
];

export default function VolunteerInformationPage() {
  return (
    <>
      <PageHero
        image={asset('/images/_DSC0109.jpg')}
        title="Volunteer (STM) Information"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold">
          Camp Celebrate 2026 registration is now OPEN!
        </h2>
        <div className="prose-site mt-6">
          <p>
            Camp Celebrate is only possible with the help of incredible
            volunteers. Come share in this week of Kingdom work by providing a
            space for fun, community, and belonging to families affected by
            disability.
          </p>
          <p>
            Volunteering takes three short steps: create an account, register
            for the week you want to serve (choosing the role
            &ldquo;Volunteer&rdquo;), and complete a short application telling
            us where you&rsquo;d like to help. Start here — the page walks you
            through all three.
          </p>
        </div>
        <Link href="/register/volunteer" className="btn-primary mt-6 inline-block">
          Volunteer — Start Here
        </Link>
        <div className="prose-site mt-8">
          <p>
            Already have an account? Returning volunteers, log in and pick up
            right where you left off.
          </p>
        </div>
        <Link href="/account/?next=/register/volunteer/" className="btn-outline mt-6 inline-block">
          Log In and Register
        </Link>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/20210720_201746.jpg')}
            alt="Camp Celebrate volunteers"
            className="rounded-lg shadow w-full mb-8"
          />
          <h2 className="text-3xl font-bold mb-6">Location, Dates, Schedule</h2>
          <div className="prose-site">
            <p>Carson Springs Baptist Conference Center in Newport, TN</p>
            <p>
              2026 Dates:
              <br />
              July 19 - 24 and
              <br />
              July 26 - July 31
            </p>
            <p>
              Each week volunteers arrive at camp on Sunday morning and depart
              by 3:00 PM on Friday. Specific arrival times are to be
              determined.
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/DSC_0597.jpg')}
          alt="Camp Celebrate volunteers"
          className="rounded-lg shadow w-full mb-8"
        />
        <h2 className="text-3xl font-bold mb-6">Cost</h2>
        <p className="text-4xl font-bold text-brand mb-6">$495 a week</p>
        <div className="prose-site">
          <p>
            Assistance is available for the second week if a volunteer wishes
            to participate in both weeks.
          </p>
          <p>
            Keep in mind, this is a mission trip! You are leaving home and
            availing yourself to serve and share the love of Jesus with those
            whom the Lord loves. Don&rsquo;t be shy in asking for support for
            this week just as you would if you were going halfway around the
            world!
          </p>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0340.jpg')}
            alt="Camp Celebrate volunteers"
            className="rounded-lg shadow w-full mb-8"
          />
          <h2 className="text-3xl font-bold mb-6">What to Expect</h2>
          <div className="prose-site">
            <p>
              The first day and a half of camp for STMs (short term
              missionaries) is filled with training to ensure you are equipped
              to effectively serve our families affected by disabilities. There
              will be plenty of time to ask questions! You will likely be a
              buddy assigned to a camper who has a disability. You will be
              there to help them, get to know their family, and give your
              camper the best Family Retreat possible! (You will not be
              required to help with the toileting needs of your buddies)
            </p>
            <p>
              If you are not assigned a specific camper, you&rsquo;ll be
              assigned as a helper in one of the program areas. You&rsquo;ll
              find out this assignment during your first day of training.
            </p>
            <p>
              You will stay on campus in an assigned bunkhouse or cabin with
              other volunteers for your home away from home.
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/DSC_0382.jpg')}
          alt="Camp Celebrate volunteers"
          className="rounded-lg shadow w-full mb-8"
        />
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
