/**
 * A literal timecode ruler — the visual signature reused across the
 * landing page hero and the processing screen. Not decorative: it's the
 * actual vernacular of every video timeline (tick marks + timecodes),
 * repurposed here to show pipeline stages laid out along a timeline
 * instead of generic numbered-circle steps.
 */
export default function TimelineRuler({ marks = 10, className = '', tone = 'dark' }) {
  const isLight = tone === 'light';
  const railColor = isLight ? 'bg-line-light' : 'bg-line-dark';
  const majorTick = isLight ? 'bg-ink/50' : 'bg-slate';
  const minorTick = isLight ? 'bg-ink/20' : 'bg-line-dark';

  return (
    <div className={`relative h-6 w-full ${className}`} aria-hidden="true">
      <div className={`absolute inset-x-0 top-0 h-px ${railColor}`} />
      <div className="flex h-full items-start justify-between">
        {Array.from({ length: marks + 1 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className={`w-px ${i % 5 === 0 ? `h-2.5 ${majorTick}` : `h-1.5 ${minorTick}`}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
