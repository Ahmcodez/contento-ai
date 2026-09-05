'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * One deep-dive block per real feature, for SEO and for people who
 * scroll past the pipeline overview wanting more than one line per
 * stage. Copy is written to be specific and honest about what the
 * product does — no invented stats, no keyword stuffing — since
 * genuinely useful, specific copy is also what search engines reward.
 *
 * Each feature has an `image` slot: a clearly labeled placeholder
 * describing exactly what real asset belongs there, its ideal aspect
 * ratio, and a suggested pixel size, so it's a straight swap-in once
 * that asset exists (see the `imagePlaceholder` src/img/... comment
 * next to each entry, and the summary list in the chat where this was
 * introduced).
 */
const FEATURES = [
  {
    id: 'transcription',
    heading: 'Accurate, timestamped transcription for every video',
    body: "Every upload runs through automatic speech-to-text transcription, broken into segments and tied to an exact timestamp in the source video. That transcript is the foundation for everything else on this page — clip detection, blog posts, and social copy all work from what was actually said, not a summary of a summary. If you've ever repurposed a podcast or interview by hand, this is usually the step that ate the most time; here it happens automatically the moment your upload finishes.",
    imagePlaceholder: 'IMAGE: transcript panel, timestamped segments visible — 4:3, ~1000×750',
    aspect: 'aspect-[4/3]',
  },
  {
    id: 'clip-detection',
    heading: 'AI that finds your best moments — and shows its work',
    body: 'Instead of scrubbing through an hour of footage for a good soundbite, the pipeline reads the full transcript for strong opinions, stories, and quotable moments, then scores each candidate clip on hook strength, clarity, and whether it stands on its own outside the original context. You get a ranked shortlist instead of a wall of raw footage — you still decide what to post, but you decide from the moments most likely to actually land.',
    imagePlaceholder: 'IMAGE: clip shortlist with score badges — 4:3, ~1000×750',
    aspect: 'aspect-[4/3]',
  },
  {
    id: 'vertical-clips',
    heading: 'Ready-to-post vertical clips, captioned automatically',
    body: 'Once a clip is selected, it renders in 9:16 vertical format with burned-in captions and a thumbnail — the format every short-form platform expects, produced without opening an editor. No manual cropping, no separately generating and syncing captions by hand. Each clip comes out the other side ready to upload to TikTok, Reels, or Shorts.',
    imagePlaceholder: 'IMAGE: rendered vertical clip with captions visible — 9:16, ~450×800',
    aspect: 'aspect-[9/16] max-w-[220px] mx-auto',
  },
  {
    id: 'blog-post',
    heading: 'A full blog post, written from what was actually said',
    body: "A blog post gets written directly from your video's transcript — grounded in your specific points, examples, and phrasing, not a generic AI article that happens to share a topic. It's a genuine head start on turning a podcast episode or talk into written content, not a draft you have to fact-check line by line against the source.",
    imagePlaceholder: 'IMAGE: generated blog post in the content tab — 4:3, ~1000×750',
    aspect: 'aspect-[4/3]',
  },
  {
    id: 'social-copy',
    heading: 'LinkedIn, X, Instagram, and YouTube copy — from one upload',
    body: 'Alongside the blog post, the pipeline writes platform-specific copy: a LinkedIn post, an X post, an Instagram caption, and a YouTube description — each suited to that platform, each grounded in the same transcript as everything else. One upload turns into a full content set instead of four separate writing sessions.',
    imagePlaceholder: 'IMAGE: grid of the four platform-copy cards — 16:9, ~1000×600',
    aspect: 'aspect-video',
  },
];

function FeatureRow({ feature, reverse }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      id={feature.id}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.4, margin: '-40px' }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="grid items-center gap-10 scroll-mt-24 lg:grid-cols-2 lg:gap-16"
    >
      <div className={reverse ? 'lg:order-2' : ''}>
        <h3 className="font-jakarta text-2xl font-semibold text-graphite">{feature.heading}</h3>
        <p className="mt-4 text-[15px] leading-relaxed text-steel">{feature.body}</p>
      </div>
      <div className={reverse ? 'lg:order-1' : ''}>
        <div
          className={`flex ${feature.aspect} w-full items-center justify-center rounded-2xl border border-dashed border-mist bg-ice-50 p-6 text-center text-[13px] leading-relaxed text-steel`}
        >
          {feature.imagePlaceholder}
        </div>
      </div>
    </motion.div>
  );
}

export default function FeatureShowcase() {
  return (
    <section className="bg-white px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="font-jakarta text-3xl font-bold text-graphite sm:text-4xl">What one upload gets you</h2>
          <p className="mt-3 text-steel">
            Five real outputs, all grounded in the same transcript — not five separate tools bolted
            together.
          </p>
        </div>

        <div className="mt-16 flex flex-col gap-20">
          {FEATURES.map((feature, i) => (
            <FeatureRow key={feature.id} feature={feature} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
