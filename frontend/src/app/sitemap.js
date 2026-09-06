const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://contento.example';

export default function sitemap() {
  // Only the real marketing homepage exists as indexable content today.
  // Add entries here as more public content pages (e.g. a blog, a
  // pricing page) ship — auth flows and the authenticated app are
  // deliberately excluded, see robots.js.
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
