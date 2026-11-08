// TODO: set NEXT_PUBLIC_SITE_URL to the real production domain; canonical URLs, structured data
// and the sitemap are all built from it.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://contento.example';
export const SITE_NAME = 'Contento';
// Where copyright takedown requests go. Must be set before launch: the acceptable-use page shows it,
// and a public downloader without a working takedown contact is a legal problem.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;
