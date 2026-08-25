const STAGES = [
  { label: 'Upload', description: 'Drop in your long-form video — a podcast episode, talk, interview, or stream.' },
  { label: 'Transcribe', description: 'Full timestamped transcript, down to the segment.' },
  { label: 'Analyze', description: 'Topics, stories, strong opinions, and quotable moments — identified, not guessed.' },
  { label: 'Find clips', description: 'Candidate moments scored on hook strength, clarity, and whether they stand alone.' },
  { label: 'Render', description: 'Vertical 9:16 clips with burned-in captions and a thumbnail, ready to post.' },
  { label: 'Write', description: 'Blog post, LinkedIn, X, Instagram caption, and YouTube description — grounded in the transcript.' },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-line-dark">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-3xl text-paper">How it works</h2>
        <p className="mt-2 max-w-lg text-slate">
          One upload runs through a real pipeline — every stage produces something you can inspect.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-line-dark bg-line-dark sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((stage, i) => (
            <div key={stage.label} className="bg-ink p-6">
              <span className="font-mono text-[12px] tabular text-tally">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-2 font-display text-lg text-paper">{stage.label}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate">{stage.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
