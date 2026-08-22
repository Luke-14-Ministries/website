import Link from 'next/link';
import { site } from '@/lib/site';

export default function Footer() {
  return (
    <footer className="bg-brand-dark text-white mt-16">
      <div className="container-site py-12 grid gap-8 sm:grid-cols-3">
        <div>
          <h4 className="text-lg font-bold mb-3">Luke 14 Ministries</h4>
          {site.address.map((line) => (
            <p key={line} className="text-neutral-200">
              {line}
            </p>
          ))}
          <p className="text-neutral-200 mt-2">{site.phone}</p>
        </div>
        <div>
          <h4 className="text-lg font-bold mb-3">Info</h4>
          <ul className="space-y-1.5 text-neutral-200">
            <li><Link href="/mission" className="hover:underline">About</Link></li>
            <li><Link href="/contact" className="hover:underline">Contact</Link></li>
            <li><Link href="/donate" className="hover:underline">Donate</Link></li>
            <li><Link href="/account/dashboard/" className="hover:underline">My Account</Link></li>
          </ul>
          <p className="mt-4 text-neutral-300">Follow us on social media!</p>
          <div className="flex gap-4 mt-2 text-neutral-200">
            <a href={site.social.facebook} aria-label="Facebook" className="hover:underline">Facebook</a>
            <a href={site.social.instagram} aria-label="Instagram" className="hover:underline">Instagram</a>
            <a href={site.social.youtube} aria-label="YouTube" className="hover:underline">YouTube</a>
          </div>
        </div>
        <div>
          <h4 className="text-lg font-bold mb-3">Programs</h4>
          <ul className="space-y-1.5 text-neutral-200">
            <li><Link href="/camp-celebrate" className="hover:underline">Camp Celebrate</Link></li>
            <li><Link href="/luke-14-party" className="hover:underline">Luke 14 Party</Link></li>
            <li><Link href="/wheels-for-kenya" className="hover:underline">Wheels for Kenya</Link></li>
            <li><Link href="/the-hazelnut-movement" className="hover:underline">The Hazelnut Movement</Link></li>
            <li><Link href="/adult-adventure-retreat" className="hover:underline">Adult Adventure Retreat</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/20 py-4 text-center text-sm text-neutral-300">
        © {new Date().getFullYear()} Luke 14 Ministries · Luke 14 Ministries is a
        501(c)3 non-profit ministry.
      </div>
    </footer>
  );
}
