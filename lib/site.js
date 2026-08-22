// Prefixes local asset paths with the GitHub Pages basePath when set.
export const asset = (p) => (process.env.NEXT_PUBLIC_BASE_PATH || '') + p;

export const site = {
  name: 'Luke 14 Ministries',
  tagline:
    'Luke 14 Ministries helps families and individuals affected by disability find community and connection to Jesus through His church.',
  address: ['2348 W Andrew Johnson Hwy, #140', 'Morristown, TN 37814'],
  phone: '(423) 748-4954',
  emails: {
    info: 'info@luke14ministries.net',
    darlene: 'darlene@luke14ministries.net',
    camp: 'camp@luke14ministries.net',
  },
  social: {
    facebook: 'https://www.facebook.com/serveandbeserved',
    instagram: 'https://www.instagram.com/l14ministries/',
    twitter: 'https://twitter.com/L14Ministries',
    youtube: 'https://www.youtube.com/channel/UCzLtQCa20yV-4Ah8f8WDb0g/featured',
  },
  logo: asset('/images/Luke_14_Ministries_Logo__285_x_2_in_29.png'),
};

export const nav = [
  {
    label: 'About',
    items: [
      { label: 'Mission & Story', href: '/mission' },
      { label: 'Leadership', href: '/leadership' },
      { label: 'Resources', href: '/resources' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { label: 'Camp Celebrate', href: '/camp-celebrate' },
      { label: 'Luke 14 Party', href: '/luke-14-party' },
      { label: 'Wheels For Kenya', href: '/wheels-for-kenya' },
      { label: 'The Hazelnut Movement', href: '/the-hazelnut-movement' },
      { label: 'Adult Adventure Retreat', href: '/adult-adventure-retreat' },
    ],
  },
  {
    label: 'Support',
    items: [
      { label: 'Volunteer', href: '/volunteer-information' },
      { label: 'Donate', href: '/donate' },
      { label: 'Pray', href: '/pray' },
      { label: 'Newsletter', href: '/newsletter' },
      { label: 'Host a Speaker', href: '/host-a-speaker' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
  // Straight to the dashboard, not the /account login page. Logged in, this
  // lands with no intermediate hop; logged out, the middleware bounces it to
  // the login form with ?next= already set -- the same status check the old
  // /account link performed, minus the visible flash of the login screen on
  // the way through (reported as "mildly confusing", 22 Aug 2026).
  { label: 'My Account', href: '/account/dashboard/', items: null },
];
