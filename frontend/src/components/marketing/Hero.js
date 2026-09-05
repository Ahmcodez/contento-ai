import Link from 'next/link';
import Button from '@/components/ui/Button';
import TimelineRuler from '@/components/ui/TimelineRuler';

export default function Hero() {
  return (
    // TEMP: hero-bg-temp.png is a placeholder background — swap/crop/position
    // properly before ship. Tracked as a follow-up, not final art.
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-right bg-no-repeat"
        style={{ backgroundImage: "url('/hero-bg-temp.png')" }}
        aria-hidden="true"
      />
      {/* Protective scrim so copy stays legible regardless of what sits
          underneath it in the art — solid where the text lives, clear
          over the illustration on the right. */}
      <div className="absolute inset-0 bg-gradient-to-r from-paper via-paper/95 to-paper/10" aria-hidden="true" />

      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tally opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-tally shadow-glow-sm" />
          </span>
          <p className="text-[13px] font-medium uppercase tracking-[0.1em] text-tally">Content repurposing</p>
        </div>
        <h1 className="mt-5 max-w-3xl font-geo text-6xl font-semibold leading-[1.02] tracking-tightest text-ink sm:text-7xl">
          Turn one long video into <em className="not-italic text-tally">everything</em> your audience needs.
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink/70">
          Upload a podcast, talk, or long-form video. Contento transcribes it, finds the moments worth
          clipping, ranks them, renders vertical clips with captions, and writes the blog post, social
          copy, and description — grounded in what was actually said.
        </p>
        <div className="mt-8 flex items-center gap-4">
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
          <a href="#how-it-works" className="text-sm text-ink/60 hover:text-ink">
            See how it works →
          </a>
        </div>

        <div className="mt-20">
          <TimelineRuler marks={24} tone="light" />
          <div className="mt-2 flex justify-between font-mono text-[11px] tabular text-ink/50">
            <span>00:00:00</span>
            <span>00:24:00</span>
            <span>00:48:00</span>
          </div>
        </div>
      </div>
    </section>
  );
}
