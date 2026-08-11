import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';

export const metadata = { title: 'Staff Admin — Luke 14 Ministries' };

// The full planned admin structure, gated by role. `ready: false` items show as
// greyed placeholders so the shape of the system (and the access model) is visible
// while the pages get built one at a time.
const NAV = [
  { href: '/admin', label: 'Overview', need: 'staff', ready: true },
  { href: '/admin/rosters', label: 'Rosters', need: 'registrar', ready: true },
  { href: '/admin/dietary', label: 'Dietary & Allergies', need: 'sensitive', ready: false },
  { href: '/admin/medical', label: 'Medical & Support', need: 'sensitive', ready: false },
  { href: '/admin/volunteers', label: 'Volunteers', need: 'registrar', ready: false },
  { href: '/admin/activities', label: 'Activities', need: 'coordinator', ready: false },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'coordinator', ready: false },
  { href: '/admin/payments', label: 'Payments', need: 'registrar', ready: false },
  { href: '/admin/setup', label: 'Setup', need: 'admin', ready: false },
  { href: '/admin/staff', label: 'Staff & Access', need: 'admin', ready: false },
];

export default async function AdminLayout({ children }) {
  const staff = await getStaff();
  // Not staff (or not signed in) -> bounce to login, then back here.
  if (!staff) redirect('/account/?next=/admin/');

  const items = NAV.filter((n) => can(staff, n.need));

  return (
    <section className="bg-neutral-50 min-h-[70vh]">
      <div className="container-site py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Staff Admin</h1>
            <p className="text-sm text-neutral-500">
              {staff.title || staff.role} · {staff.email}
              {staff.can_view_sensitive ? ' · sensitive access' : ''}
            </p>
          </div>
          <Link href="/account/dashboard/" className="btn-outline !py-1.5 text-sm">
            My Account
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <nav className="flex flex-col gap-1">
            {items.map((n) =>
              n.ready ? (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded px-3 py-2 font-medium hover:bg-neutral-200"
                >
                  {n.label}
                </Link>
              ) : (
                <span
                  key={n.href}
                  title="Coming soon"
                  className="rounded px-3 py-2 text-neutral-400 cursor-default"
                >
                  {n.label} <span className="text-xs">· soon</span>
                </span>
              )
            )}
          </nav>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
