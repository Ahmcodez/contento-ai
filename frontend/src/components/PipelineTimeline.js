const STAGES = [
  { group: 'uploading', label: 'Upload' },
  { group: 'preparing', label: 'Extract' },
  { group: 'transcribing', label: 'Transcribe' },
  { group: 'analyzing', label: 'Analyze' },
  { group: 'rendering', label: 'Render clips' },
  { group: 'writing', label: 'Write content' },
  { group: 'finishing', label: 'Finish' },
];

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.group, i]));

/**
 * Shows the processing pipeline as stages positioned along a literal
 * timeline — the same ruler motif used on the landing page (see
 * TimelineRuler) — rather than a row of numbered circles. Each stage is
 * marked done / active / pending based on the job's real stateGroup.
 */
export default function PipelineTimeline({ stateGroup, failed, cancelled }) {
  const currentIndex = failed || cancelled ? -1 : stateGroup === 'completed' ? STAGES.length : STAGE_INDEX[stateGroup] ?? -1;

  return (
    <div>
      <div className="relative flex items-start justify-between">
        <div className="absolute left-0 right-0 top-[7px] h-px bg-line-dark" />
        {STAGES.map((stage, i) => {
          const isDone = currentIndex > i || stateGroup === 'completed';
          const isActive = i === currentIndex && !isDone;
          return (
            <div key={stage.group} className="relative z-10 flex flex-col items-center gap-2" style={{ flex: 1 }}>
              <div
                className={`h-[15px] w-[15px] rounded-full border-2 transition-colors
                  ${isDone ? 'border-tally bg-tally' : isActive ? 'border-tally bg-ink' : 'border-line-dark bg-ink'}`}
              >
                {isActive && <span className="block h-full w-full animate-ping rounded-full bg-tally/60" />}
              </div>
              <span
                className={`text-center text-[11px] font-medium leading-tight
                  ${isDone || isActive ? 'text-paper' : 'text-slate-dim'}`}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      {(failed || cancelled) && (
        <p className="mt-4 text-center text-[13px] text-slate">
          {failed ? 'Processing stopped before finishing.' : 'Processing was cancelled.'}
        </p>
      )}
    </div>
  );
}
