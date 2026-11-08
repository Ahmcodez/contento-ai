import Link from 'next/link';
import MarketingNav from '@/components/layout/MarketingNav';
import Footer from '@/components/layout/Footer';
import DownloaderTool from '@/components/downloader/DownloaderTool';
import { SITE_URL, SITE_NAME } from '@/lib/siteConfig';
import { DOWNLOADER_PAGES, DOWNLOADER_LINKS, SUPPORTED_SITES } from '@/lib/downloaderPages';

/** Next.js metadata for a downloader page, from the same data the page renders. */
export function downloaderMetadata(page) {
  return {
    // `absolute` so the site-wide "— Contento" suffix doesn't push a title past what search results show.
    title: { absolute: page.metaTitle },
    description: page.metaDescription,
    alternates: { canonical: page.path },
    openGraph: { type: 'website', url: page.path, siteName: SITE_NAME, title: page.metaTitle, description: page.metaDescription },
    twitter: { card: 'summary_large_image', title: page.metaTitle, description: page.metaDescription },
  };
}

/** JSON-LD must not be able to close its own <script> tag, whatever the copy contains. */
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function structuredData(page) {
  const url = `${SITE_URL}${page.path}`;
  const graph = [
    {
      '@type': 'WebApplication',
      name: page.h1,
      url,
      description: page.metaDescription,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (runs in a web browser)',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        ...(page.path === '/video-downloader'
          ? [{ '@type': 'ListItem', position: 2, name: page.breadcrumb, item: url }]
          : [
              { '@type': 'ListItem', position: 2, name: DOWNLOADER_PAGES.hub.breadcrumb, item: `${SITE_URL}${DOWNLOADER_PAGES.hub.path}` },
              { '@type': 'ListItem', position: 3, name: page.breadcrumb, item: url },
            ]),
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: page.faq.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
    },
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

function Section({ section }) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <h2 className="font-jakarta text-2xl font-bold tracking-tight text-graphite">{section.heading}</h2>
      {section.paragraphs?.map((p) => (
        <p key={p.slice(0, 40)} className="mt-4 leading-relaxed text-steel">
          {p}
        </p>
      ))}
      {section.sites && (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-mist">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-mist/40 text-[12px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3 font-medium">Site</th>
                <th className="px-4 py-3 font-medium">What to expect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {SUPPORTED_SITES.map((site) => (
                <tr key={site.name}>
                  <th scope="row" className="px-4 py-3 font-medium text-graphite">
                    {site.href ? (
                      <Link href={site.href} className="underline decoration-mist underline-offset-4 hover:decoration-graphite">
                        {site.name}
                      </Link>
                    ) : (
                      site.name
                    )}
                  </th>
                  <td className="px-4 py-3 text-steel">{site.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.bullets && (
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-steel marker:text-steel/60">
          {section.bullets.map((b) => (
            <li key={b.slice(0, 40)}>{b}</li>
          ))}
        </ul>
      )}
      {section.table && (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-mist">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-mist/40 text-[12px] uppercase tracking-wide text-steel">
              <tr>
                {section.table.head.map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mist">
              {section.table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (i === 0 ? (
                    <th key={cell} scope="row" className="px-4 py-3 font-medium text-graphite">
                      {cell}
                    </th>
                  ) : (
                    <td key={cell} className="px-4 py-3 text-steel">
                      {cell}
                    </td>
                  )))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.paragraphs2?.map((p) => (
        <p key={p.slice(0, 40)} className="mt-4 leading-relaxed text-steel">
          {p}
        </p>
      ))}
    </section>
  );
}

/**
 * A full downloader landing page: the working tool first (that is what the visitor came for),
 * then the explanation, then the questions. Server-rendered, so all of the text is in the HTML
 * a search engine fetches; only the tool itself is interactive.
 */
export default function DownloaderPage({ page }) {
  const others = DOWNLOADER_LINKS.filter((l) => l.href !== page.path);

  return (
    <>
      <MarketingNav />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJson(structuredData(page)) }} />

        <section className="bg-ice-hero px-6 pb-16 pt-14 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <nav aria-label="Breadcrumb" className="mb-6 text-[13px] text-steel">
              <Link href="/" className="hover:text-graphite">
                Home
              </Link>
              {page.path !== '/video-downloader' && (
                <>
                  {' / '}
                  <Link href="/video-downloader" className="hover:text-graphite">
                    {DOWNLOADER_PAGES.hub.breadcrumb}
                  </Link>
                </>
              )}
              {' / '}
              <span className="text-graphite">{page.breadcrumb}</span>
            </nav>
            <h1 className="font-jakarta text-4xl font-extrabold leading-tight tracking-tight text-graphite sm:text-5xl">{page.h1}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-steel">{page.intro}</p>
            <div className="mt-8 text-left">
              <DownloaderTool placeholder={page.placeholder} idPrefix="page" />
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-3xl space-y-14 px-6 py-16">
          <section id="how-to">
            <h2 className="font-jakarta text-2xl font-bold tracking-tight text-graphite">{page.stepsHeading}</h2>
            <ol className="mt-6 space-y-5">
              {page.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-graphite text-sm font-semibold text-white">{i + 1}</span>
                  <div>
                    <h3 className="font-semibold text-graphite">{step.title}</h3>
                    <p className="mt-1 leading-relaxed text-steel">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {page.sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}

          <section id="faq">
            <h2 className="font-jakarta text-2xl font-bold tracking-tight text-graphite">Frequently asked questions</h2>
            <div className="mt-6 divide-y divide-mist rounded-2xl border border-mist">
              {page.faq.map((item) => (
                <details key={item.q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-graphite">
                    {item.q}
                    <span aria-hidden="true" className="text-steel transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-steel">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="rounded-3xl bg-ice-hero px-6 py-10 text-center">
            <h2 className="font-jakarta text-2xl font-bold tracking-tight text-graphite">Need clips from a long video?</h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-steel">
              Contento finds the strongest moments in a podcast, talk or webinar, cuts them into short vertical clips with captions, and writes a blog post and
              social posts from what was said.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-brand-gradient px-7 text-[15px] font-medium text-white shadow-pill-glow hover:brightness-110"
            >
              Try Contento free
            </Link>
          </section>

          <nav aria-label="Related tools">
            <h2 className="font-jakarta text-lg font-bold text-graphite">More free downloaders</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {others.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-block rounded-full border border-mist px-4 py-2 text-sm text-steel hover:border-steel hover:text-graphite">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
      <Footer />
    </>
  );
}
