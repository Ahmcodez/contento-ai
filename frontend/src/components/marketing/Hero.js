import Link from 'next/link';
import Button from '@/components/ui/Button';

const LOGO_PLACEHOLDERS = ['Logo one', 'Logo two', 'Logo three', 'Logo four', 'Logo five'];

export default function Hero() {
  return (
    <section className="relative bg-ice-hero px-6 pb-24 pt-20 sm:pt-28">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="font-jakarta text-5xl font-extrabold leading-[1.08] tracking-tight text-graphite sm:text-6xl">
          Turn one video into <span className="text-gradient-brand">everything</span> your audience needs
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-steel sm:text-xl">
          Upload a podcast, talk, or long-form video. Get ranked short clips with captions, plus a blog
          post and social copy — grounded in what was actually said, not guessed.
        </p>

        {/* Integrated upload/start bar */}
        <div className="mx-auto mt-9 flex max-w-2xl flex-col gap-2 rounded-[28px] border border-mist bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:rounded-full">
          <input
            type="text"
            placeholder="Drop a video file to get started"
            className="w-full flex-1 rounded-full bg-transparent px-5 py-3 text-sm text-graphite placeholder:text-steel/70 focus:outline-none"
          />
          <div className="flex gap-2 px-1 pb-1 sm:px-0 sm:pb-0">
            <Link href="/signup" className="flex-1 sm:flex-none">
              <Button variant="gradientPill" size="lg" className="w-full sm:w-auto">
                Try for free
              </Button>
            </Link>
            <Link href="/signup" className="hidden sm:block">
              <Button variant="outlinePill" size="lg">
                Upload files
              </Button>
            </Link>
          </div>
        </div>
        <p className="mt-3 text-xs text-steel">No credit card required · Free plan available</p>

        {/* Hero preview media frame — swap for a real product screen recording */}
        <div className="relative mx-auto mt-14 aspect-video w-full max-w-4xl overflow-hidden rounded-2xl border border-mist bg-white shadow-xl shadow-slate-900/5">
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ice-50 to-ice-100 text-sm text-steel">
            [ Product demo preview — swap in a real screen recording ]
          </div>
        </div>

        {/* Social proof — placeholders only until there are real logos to show */}
        <div className="mt-14">
          <p className="text-xs uppercase tracking-wide text-steel">Built for creators who publish everywhere</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {LOGO_PLACEHOLDERS.map((label) => (
              <div
                key={label}
                className="flex h-8 w-24 items-center justify-center rounded border border-dashed border-mist text-[11px] text-steel/80"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
