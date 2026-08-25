/**
 * A literal timecode ruler — the visual signature reused across the
 * landing page hero and the processing screen. Not decorative: it's the
 * actual vernacular of every video timeline (tick marks + timecodes),
 * repurposed here to show pipeline stages laid out along a timeline
 * instead of generic numbered-circle steps.
 */
export default function TimelineRuler({ marks = 10, className = '' }) {
  return (
    <div className={`relative h-6 w-full ${className}`} aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-px bg-line-dark" />
      <div className="flex h-full items-start justify-between">
        {Array.from({ length: marks + 1 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className={`w-px ${i % 5 === 0 ? 'h-2.5 bg-slate' : 'h-1.5 bg-line-dark'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
