import { SITE_URL } from '@/lib/siteConfig';
import { DOWNLOADER_PAGES } from '@/lib/downloaderPages';

// Only public marketing content belongs here. Auth flows and the signed-in app are deliberately
// excluded, see robots.js. Pages are listed from the same data that renders them, so a new
// downloader page can't be shipped without being in the sitemap.
export default function sitemap() {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    ...Object.values(DOWNLOADER_PAGES).map((page) => ({
      url: `${SITE_URL}${page.path}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: page.path === '/video-downloader' ? 0.9 : 0.8,
    })),
    { url: `${SITE_URL}/acceptable-use`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
