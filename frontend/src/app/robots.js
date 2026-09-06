const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://contento.example';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Authenticated app screens and auth flows have nothing for a
        // crawler to usefully index and would otherwise dilute the
        // marketing homepage's relevance signal.
        disallow: ['/dashboard', '/projects', '/usage', '/login', '/signup', '/forgot-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
