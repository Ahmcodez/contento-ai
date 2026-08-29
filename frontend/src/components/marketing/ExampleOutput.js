import Badge from '@/components/ui/Badge';

const EXAMPLE_CLIPS = [
  { title: 'Why persistence beats talent', score: 91, range: '12:04 – 12:58', topic: 'entrepreneurship' },
  { title: 'The pricing mistake everyone makes', score: 84, range: '28:41 – 29:50', topic: 'business' },
  { title: 'A surprising stat about churn', score: 78, range: '41:12 – 41:47', topic: 'growth' },
];

export default function ExampleOutput() {
  return (
    <section className="border-t border-line-dark">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-3xl text-paper">From one upload</h2>
          <span className="text-[12px] uppercase tracking-[0.06em] text-slate-dim">Example output</span>
        </div>
        <p className="mt-2 max-w-lg text-slate">
          A single 45-minute upload becomes a set of ranked clips and a full round of written content.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-4 text-[13px] font-medium uppercase tracking-[0.06em] text-slate-dim">Ranked clips</h3>
            <div className="flex flex-col gap-3">
              {EXAMPLE_CLIPS.map((clip) => (
                <div
                  key={clip.title}
                  className="flex items-center justify-between rounded-[4px] border border-line-dark p-4"
                >
                  <div>
                    <p className="text-sm text-paper">{clip.title}</p>
                    <p className="mt-1 font-mono text-[11px] tabular text-slate-dim">{clip.range}</p>
                  </div>
                  <Badge tone={clip.score >= 85 ? 'success' : 'warning'}>{clip.score}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-[13px] font-medium uppercase tracking-[0.06em] text-slate-dim">
              Grounded written content
            </h3>
            <div className="rounded-[4px] border border-line-dark p-5">
              <span className="text-[11px] uppercase tracking-[0.06em] text-tally">LinkedIn</span>
              <p className="mt-3 text-[14px] leading-relaxed text-paper/90">
                Most people think talent is the deciding factor in whether a startup survives its first
                year. It isn&apos;t — persistence is. Here&apos;s the story of a failure that taught me
                that the hard way, and why I&apos;d make the same bet again…
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
