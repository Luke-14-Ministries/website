import Link from 'next/link';
import { asset } from '@/lib/site';

const programs = [
  {
    title: 'Camp Celebrate',
    href: '/camp-celebrate',
    image:
      asset('/images/DSC_0012.jpg'),
  },
  {
    title: 'Luke 14 Party',
    href: '/luke-14-party',
    image:
      asset('/images/DSC_4801.jpg'),
  },
  {
    title: 'The Hazelnut Movement',
    href: '/the-hazelnut-movement',
    image:
      asset('/images/tempImageocqVEH.jpg'),
  },
  {
    title: 'Wheels for Kenya',
    href: '/wheels-for-kenya',
    image:
      asset('/images/Picture2.jpg'),
  },
];

const actions = [
  {
    title: 'Volunteer',
    href: '/volunteer-information',
    image:
      asset('/images/DSC_0199.jpg'),
  },
  {
    title: 'Donate',
    href: '/donate',
    image:
      asset('/images/Kenya_2018_3268.jpg'),
  },
  {
    title: 'Pray',
    href: '/pray',
    image:
      asset('/images/DSC_0264.jpg'),
  },
];

function ImageCard({ title, href, image, tall }) {
  return (
    <Link href={href} className="group relative block overflow-hidden rounded-lg shadow">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={title}
        className={`w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
          tall ? 'h-80' : 'h-64'
        }`}
      />
      <div className="absolute inset-0 bg-black/35 group-hover:bg-black/45 transition-colors" />
      <h2 className="absolute inset-x-0 bottom-6 text-center text-white text-2xl sm:text-3xl font-bold drop-shadow">
        {title}
      </h2>
    </Link>
  );
}

export default function HomePage() {
  return (
    <>
      <section
        className="relative flex items-center justify-center min-h-[480px] bg-cover bg-center"
        style={{
          backgroundImage:
            `url(${asset('/images/IMG_3690_2__281_29.jpg')})`,
        }}
      >
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative container-site py-20 text-center">
          <h1 className="mx-auto max-w-4xl text-3xl sm:text-4xl lg:text-[2.6rem] leading-snug font-bold text-white drop-shadow">
            Luke 14 Ministries helps families and individuals affected by
            disability find community and connection to Jesus through His
            church.
          </h1>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/camp-celebrate" className="btn-primary">
              Camp Celebrate 2027
            </Link>
            <Link href="/donate" className="btn-gold">
              Donate
            </Link>
          </div>
        </div>
      </section>

      <section className="container-site py-14">
        <h2 className="text-3xl font-bold text-center mb-8">Our Programs</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {programs.map((p) => (
            <ImageCard key={p.href} {...p} tall />
          ))}
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site">
          <h2 className="text-3xl font-bold text-center mb-8">Get Involved</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {actions.map((a) => (
              <ImageCard key={a.href} {...a} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
