'use client';

import { motion, useReducedMotion } from 'framer-motion';

const REASONS = [
  {
    heading: 'Repurposing used to eat an afternoon — now it runs while you do something else',
    body: 'Finding the good moments in an hour of footage, cropping and captioning a clip, then separately writing a blog post and social copy for it, is normally four or five different tasks. Here it is one upload.',
  },
  {
    heading: 'Every output is grounded in what you actually said',
    body: "The blog post, the social copy, and the clip selection all come from your video's real transcript — not a generic AI summary of the general topic. What you get back is specific to your video, not a template with your title dropped in.",
  },
  {
    heading: "One upload, a creator's whole content set",
    body: 'Vertical clips, a blog post, and copy for LinkedIn, X, Instagram, and YouTube all come out of the same pipeline run — built to give a solo creator or small team something close to what a repurposing agency would hand back.',
  },
  {
    heading: 'Paste a link from anywhere — YouTube, Twitch, TikTok, or elsewhere',
    body: "File upload works today. Pasting a link directly from YouTube, Twitch, TikTok, or other platforms — no download-and-reupload step — is next on the roadmap, for any video you're legally able to repurpose.",
    upcoming: true,
  },
];

export default function WhyChooseUs() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section id="why-us" className="bg-white px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="font-jakarta text-3xl font-bold text-graphite sm:text-4xl">
              Why creators choose Contento
            </h2>
            <p className="mt-3 max-w-md text-steel">
              Not a bigger tool stack — a shorter one. Here&apos;s what that actually means in practice.
            </p>

            <div className="mt-10 flex flex-col gap-8">
              {REASONS.map((reason, i) => (
                <motion.div
                  key={reason.heading}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: false, amount: 0.5, margin: '-40px' }}
                  transition={{ duration: 0.6, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-jakarta text-lg font-semibold text-graphite">{reason.heading}</h3>
                    {reason.upcoming && (
                      <span className="shrink-0 rounded-full bg-accent-violet/10 px-2.5 py-0.5 text-[11px] font-medium text-accent-violet">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-steel">{reason.body}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.4, margin: '-40px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="flex aspect-square w-full items-center justify-center self-start rounded-2xl border border-dashed border-mist bg-ice-50 p-6 text-center text-[13px] leading-relaxed text-steel lg:sticky lg:top-24"
          >
            IMAGE: one link/file going in, a fan of outputs (clips, blog, social posts) coming out — square
            or 4:5, ~900×900
          </motion.div>
        </div>
      </div>
    </section>
  );
}
