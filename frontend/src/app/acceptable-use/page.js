import Link from 'next/link';
import MarketingNav from '@/components/layout/MarketingNav';
import Footer from '@/components/layout/Footer';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/siteConfig';

export const metadata = {
  title: 'Acceptable use and copyright',
  description: `How the ${SITE_NAME} video downloader may be used, and how copyright owners can ask for a video to be blocked.`,
  alternates: { canonical: '/acceptable-use' },
};

const H2 = 'mt-12 font-jakarta text-2xl font-bold tracking-tight text-graphite';
const P = 'mt-4 leading-relaxed text-steel';

export default function AcceptableUse() {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-jakarta text-4xl font-extrabold tracking-tight text-graphite">Acceptable use and copyright</h1>
        <p className={P}>
          The free video downloader on this site saves a copy of a video for you to keep. That can be perfectly fine or it can infringe someone’s rights, depending on the
          video and what you do with it. This page explains what we expect from people who use it, and what rights holders can do if something shouldn’t be available.
          It is general information, not legal advice.
        </p>

        <h2 className={H2}>What you may download</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-steel">
          <li>Videos you made or own.</li>
          <li>Videos in the public domain, or published under a licence that lets you copy them (for example some Creative Commons licences).</li>
          <li>Videos whose owner has given you permission to save them.</li>
        </ul>

        <h2 className={H2}>What you may not do</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-steel">
          <li>Download videos you have no right to copy, or re-upload, sell or redistribute other people’s work.</li>
          <li>Use the downloader to get around paywalls, access controls, or a creator’s choice to disable downloads.</li>
          <li>Run it in bulk or with automated tools. It has per-person limits to keep it working for everyone, and attempts to get around them may be blocked.</li>
          <li>Use it for anything unlawful, or to harass, impersonate or harm someone.</li>
        </ul>

        <h2 className={H2}>The terms of the sites you download from</h2>
        <p className={P}>
          YouTube, TikTok, Vimeo and other sites have their own terms, and many say that content should be viewed through their own features unless they provide a download
          option. Those terms apply to you as a user of those sites. Where a site offers its own download button, or you own the video and can download the original from your
          account, that is usually the better route.
        </p>

        <h2 className={H2}>How the downloader handles files</h2>
        <p className={P}>
          A file is prepared on our server only when you ask for it, is available through a private link, and is deleted about 30 minutes later. We don’t publish or index
          the videos people download and we don’t keep a library of them. To apply usage limits and prevent abuse we briefly use technical details such as your IP address.
        </p>

        <h2 className={H2}>Copyright owners: asking for a video to be blocked</h2>
        <p className={P}>
          If you own the rights to a video, or act for someone who does, and you believe it shouldn’t be downloadable through this tool, send us a notice and we will review
          it. Please include:
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-steel">
          <li>The full link (URL) of the video, exactly as it appears on the original site.</li>
          <li>Your name, your role, and how we can reach you.</li>
          <li>A statement that you own, or are authorized to act for the owner of, the rights in the video.</li>
          <li>A statement that the information in your notice is accurate.</li>
        </ul>
        <p className={P}>
          {CONTACT_EMAIL ? (
            <>
              Send it to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-graphite underline underline-offset-4">
                {CONTACT_EMAIL}
              </a>
              .
            </>
          ) : (
            'Contact details for notices will be published here.'
          )}{' '}
          When a notice is valid we block that video from the downloader. People who repeatedly misuse it may lose access.
        </p>

        <p className="mt-12 text-sm text-steel">
          Back to the{' '}
          <Link href="/video-downloader" className="underline underline-offset-4 hover:text-graphite">
            video downloader
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  );
}
