export default function ProgressBar({ value = 0, tone = 'default', showLabel = false, className = '' }) {
  const clamped = Math.max(0, Math.min(100, value));
  const barColor = tone === 'danger' ? 'bg-tally' : tone === 'success' ? 'bg-emerald-500' : 'bg-paper';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${barColor} transition-[width] duration-300 ease-out`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="font-mono text-[12px] tabular text-slate">{Math.round(clamped)}%</span>
      )}
    </div>
  );
}
