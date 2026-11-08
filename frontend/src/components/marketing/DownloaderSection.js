import Link from 'next/link';
import DownloaderTool from '@/components/downloader/DownloaderTool';
import { DOWNLOADER_PAGES, SUPPORTED_SITES } from '@/lib/downloaderPages';

const STEPS = [
  { n: 1, title: 'Copy the link', body: 'Copy the video’s address from your browser, or use Share, then Copy link, in the app.' },
  { n: 2, title: 'Paste it above', body: 'We show the formats the video really has, from small files up to 1080p, plus MP3 audio.' },
  { n: 3, title: 'Download', body: 'Press Download, wait a few seconds, then save the file. No account needed.' },
];

// Short versions of the answers on the full page; the wording is shared so the two never disagree.
const FAQ = DOWNLOADER_PAGES.hub.faq.filter((item) => /free|websites|quality|legal/i.test(item.q)).slice(0, 4);

/**
 * The free downloader on the home page: a working tool with no sign-up, then the short version of
 * what a visitor needs to know. The full guide lives at /video-downloader.
 */
export default function DownloaderSection() {
  return (
    <section id="video-downloader" className="scroll-mt-20 bg-white px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-steel">Free tool · No sign-up</p>
          <h2 className="mt-3 font-jakarta text-3xl font-extrabold tracking-tight text-graphite sm:text-4xl">Free online video downloader</h2>
          <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-steel">
            Paste a link from YouTube, TikTok, Vimeo, Facebook, Instagram, X and more. Save it as an MP4 or pull out just the audio as an MP3. Nothing to install,
            and you don’t need an account.
          </p>
        </div>

        <div className="mt-8">
          <DownloaderTool idPrefix="home" placeholder="Paste a video link here" />
        </div>

        <ol className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.n} className="rounded-2xl border border-mist p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-graphite text-sm font-semibold text-white">{step.n}</span>
              <h3 className="mt-3 font-semibold text-graphite">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-steel">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <h3 className="text-center text-[13px] font-medium uppercase tracking-[0.08em] text-steel">Works with</h3>
          <ul className="mt-4 flex flex-wrap justify-center gap-2">
            {SUPPORTED_SITES.map((site) => (
              <li key={site.name}>
                {site.href ? (
                  <Link href={site.href} className="inline-block rounded-full border border-mist px-4 py-2 text-sm text-graphite hover:border-steel">
                    {site.name}
                  </Link>
                ) : (
                  <span className="inline-block rounded-full border border-mist px-4 py-2 text-sm text-steel">{site.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-12 divide-y divide-mist rounded-2xl border border-mist">
          {FAQ.map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-graphite">
                {item.q}
                <span aria-hidden="true" className="text-steel transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-steel">{item.a}</p>
            </details>
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-steel">
          <Link href="/video-downloader" className="font-medium text-graphite underline underline-offset-4">
            Read the full guide
          </Link>
          {' · '}
          Only download videos you own or have permission to save.
        </p>
      </div>
    </section>
  );
}
