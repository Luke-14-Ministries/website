import './globals.css';
import PreviewBanner from '@/components/PreviewBanner';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import IdleTimeout from '@/components/IdleTimeout';

export const metadata = {
  title: {
    default: 'Luke 14 Ministries (Preview Build)',
    template: '%s — Luke 14 Ministries (Preview Build)',
  },
  description:
    'Luke 14 Ministries helps families and individuals affected by disability find community and connection to Jesus through His church.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PreviewBanner />
        <Header />
        <main>{children}</main>
        <Footer />
        {/* Idle auto-logout. Renders nothing unless someone is signed in and has
            gone quiet long enough to warrant the warning. */}
        <IdleTimeout />
      </body>
    </html>
  );
}
