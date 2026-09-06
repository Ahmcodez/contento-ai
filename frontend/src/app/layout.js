import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/public-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './globals.css';

// TODO: set NEXT_PUBLIC_SITE_URL to the real production domain once
// live — everything below (canonical URLs, OG/Twitter image URLs, the
// sitemap) resolves relative to this.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://contento.example';
const SITE_NAME = 'Contento';
const SITE_TITLE = 'Contento — Turn one video into everything';
const SITE_DESCRIPTION =
  'Upload a long-form video and get a timestamped transcript, ranked short clips with captions, a grounded blog post, and social copy for every platform — automatically.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    // TODO: add a real 1200x630 social preview image at
    // public/og-image.png once available — falls back to no image
    // until then rather than shipping a placeholder graphic to social
    // platforms.
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// Organization + SoftwareApplication structured data (JSON-LD), read by
// search engines for rich results. Keep every claim here in sync with
// what's actually true — structured data that overstates the product
// (fake ratings, fake pricing) is a common spam pattern engines
// specifically watch for and penalize.
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  description: SITE_DESCRIPTION,
  url: SITE_URL,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
