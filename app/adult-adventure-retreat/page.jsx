import Link from 'next/link';
import { asset } from '@/lib/site';

export const metadata = { title: 'Adult Adventure Retreat' };

// Registration links carry the program so the chooser does not ask a question
// the visitor has already answered by being on this page.
const REG = '/register/family/%3Fprogram%3DAdult%2520Adventure%2520Retreat%25202026';

// The hero borrows the BANNER'S PALETTE rather than reproducing the banner at
// full bleed. Three reasons:
//
//   1. The artwork is 16:9. Full width, it fills an entire laptop viewport
//      before a single word of the page is visible — a poster, not a header.
//   2. Its words are pixels. Dates, tagline and program name set as real text
//      can be selected, searched, read by a screen reader, and corrected in
//      one line when they change. This page having the WRONG dates until
//      today is exactly what happens when the facts live only in an image.
//   3. Keeping the artwork beside the text lets both do their job: the mark
//      and the colours carry the feel, the text carries the information.
//
// Colours sampled from the banner: deep pine, the gold of the header band, the
// mid-green of the treeline.
const PINE = '#14544A';
const GOLD = '#F7B32B';

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-0.5 font-bold">{children}</dd>
    </div>
  );
}

export default function AdultAdventureRetreatPage() {
  return (
    <>
      <section style={{ backgroundColor: PINE }} className="text-white">
        <div className="container-site py-12 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p
                className="text-sm font-bold uppercase tracking-[0.2em]"
                style={{ color: GOLD }}
              >
                Camp Celebrate
              </p>
              <h1 className="mt-2 text-4xl sm:text-5xl font-bold leading-tight">
                Adult Adventure Retreat
              </h1>
              <p className="mt-4 text-xl text-white/90">
                A retreat tailored for independent young adults affected by disability
                &mdash; adventure, worship and community in the mountains near Gatlinburg.
              </p>

              <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                <Fact label="Dates">Oct 29 &ndash; Nov 1</Fact>
                <Fact label="Arrival">6:00 PM Thursday</Fact>
                <Fact label="Cost">$480 per person</Fact>
                <Fact label="Spots">Limited to 30</Fact>
              </dl>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link href={`/account/signup/?next=${REG}`} className="btn-gold !px-8">
                  Register for the Retreat
                </Link>
                <span className="text-white/80">
                  Been before?{' '}
                  <Link
                    href={`/account/?next=${REG}`}
                    className="font-semibold underline"
                    style={{ color: GOLD }}
                  >
                    Log in and register
                  </Link>
                </span>
              </div>
            </div>

            {/* Decorative: everything it says is also said in text above, so it
                carries an empty alt rather than repeating the page to someone
                using a screen reader. */}
            <img
              src={asset('/images/adult_adventure_screen_snip.jpeg')}
              alt=""
              className="w-full h-auto rounded-lg shadow-xl"
            />
          </div>
        </div>
      </section>

      <section className="py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">What is the Adult Adventure Retreat?</h2>
          <div className="prose-site">
            <p>
              The Adult Adventure Retreat is a weekend getaway in the beautiful mountains
              near Gatlinburg, Tennessee, designed for independent young adults with
              disabilities. Hosted by Luke 14 Ministries, it is a chance to connect with
              peers, engage in worship, and enjoy real adventure in a supportive
              environment.
            </p>
            <p>
              Every participant is paired with a trained buddy for the weekend, so the
              adventure is genuinely theirs. Places are limited to 30, and they go
              &mdash; early registration is encouraged.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-brand-light py-12">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold">Ready to come?</h2>
          <p className="mt-2 text-neutral-700">
            Registration takes a few minutes. You can save your place now and add medical
            and support details later.
          </p>
          <Link href={`/account/signup/?next=${REG}`} className="btn-primary !px-8 mt-6">
            Register for the Retreat
          </Link>
        </div>
      </section>
    </>
  );
}
