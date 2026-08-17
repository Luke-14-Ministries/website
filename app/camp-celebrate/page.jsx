import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Camp Celebrate' };

const features = [
  {
    title: 'Fun',
    text: "Camp is a party! If we aren't white water rafting, riding horses, or making crafts, we are on the dance floor or showing off our gifts in a talent show.",
    image:
      asset('/images/DSC_0981.jpg'),
  },
  {
    title: 'Connection',
    text: 'Experience life-giving relationships with a network of families who understand the challenges and joys of life with disability.',
    image:
      asset('/images/DSC_0116.jpg'),
  },
  {
    title: 'Support',
    text: 'There will be a buddy assigned to your family member who has a disability. They will be there to help you, get to know you, and give your camper the best camp experience possible!',
    image:
      asset('/images/DSC_0994.jpg'),
  },
  {
    title: 'Encouragement',
    text: 'Laugh and receive encouragement as a family from morning skits and worship. Enjoy teaching and fellowship with other adults while your children learn and have fun in age appropriate programs.',
    image:
      asset('/images/DSC_0296.jpg'),
  },
];

export default function CampCelebratePage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0661.jpg')}
        title="Camp Celebrate"
        subtitle="A family retreat for those affected by disability"
      >
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/camper-information" className="btn-primary">
            Camper Information
          </Link>
          <Link href="/volunteer-information" className="btn-outline !border-white !text-white hover:!bg-white hover:!text-brand-dark">
            Volunteer Information
          </Link>
        </div>
      </PageHero>

      <section className="bg-brand-light py-14">
        <div className="container-site text-center max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold">
            Camp Celebrate 2026 registration is now OPEN!
          </h2>
          <p className="mt-4 text-lg">
            New to Camp Celebrate? Click here to create your account and
            register your family!
          </p>
          <Link href="/account/signup/?next=/register/family/" className="btn-primary mt-4">
            Get Started!
          </Link>
          <p className="mt-8 text-lg">
            Already have an account? Returning campers, click here to log in
            and register!
          </p>
          <Link href="/account/?next=/register/family/" className="btn-outline mt-4">
            Log In and Register
          </Link>
          <p className="mt-8 text-neutral-600">
            Coming to serve?{' '}
            <Link href="/register/volunteer" className="text-brand underline font-semibold">
              Volunteer registration starts here
            </Link>{' '}
            — it walks you through registration and the short volunteer
            application.
          </p>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <p className="text-2xl font-heading italic text-center text-brand-dark">
          At Camp Celebrate, people with disabilities and their families
          receive encouragement and care in the beautiful mountains of East
          Tennessee.
        </p>

        <h2 className="text-3xl font-bold mt-12 mb-6">
          What is Camp Celebrate?
        </h2>
        <div className="prose-site">
          <p>
            At Camp Celebrate, persons with disabilities and their families
            receive encouragement and care in the comfort of a safe family camp
            environment. Enjoy fully-accessible and age-appropriate fun
            activities, be nourished by hearty home-style meals, build lifelong
            relationships and glean from meaningful conversations from a
            network of families who understand the challenges of life with
            disability. You&rsquo;ll leave camp encouraged, refreshed, and just
            maybe a little bit tired from all the fun you and your family will
            have!
          </p>
          <p>
            Camp Celebrate is designed for anyone who has a disability and
            their families, young, old and everyone in between!
          </p>
          <p>Each and every camper is welcomed, appreciated, and celebrated!</p>
          <p>
            When you join us for a family retreat, you can expect lots of time
            to enjoy activities as a family, teaching and worship times as a
            large group, free time to spend while your children are well cared
            for, refreshing and encouraging time with other men and women who
            have walked a road similar to yours, fun, safe and age appropriate
            programs for each camper attending, and so much more!
          </p>
          <p>
            There will be a buddy assigned to your family member who has a
            disability, and they will stay with your camper almost 100% of the
            day. They will be there to help you, get to know you all and give
            your camper the best retreat experience possible! (They cannot help
            with personal needs, so you&rsquo;ll set meeting times and places
            to take care of those needs.)
          </p>
          <p>
            From the minute you arrive until the moment you drive away, you
            will be blessed.
          </p>
        </div>
      </section>

      <section className="container-site pb-14">
        <div className="grid gap-8 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-lg overflow-hidden shadow bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.image} alt={f.title} className="h-64 w-full object-cover" />
              <div className="p-6">
                <h3 className="text-2xl font-bold mb-2">{f.title}</h3>
                <p className="text-lg leading-relaxed">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-10">
          <Link href="/camp-memories" className="btn-outline">
            Camp Memories
          </Link>
        </div>
      </section>
    </>
  );
}
