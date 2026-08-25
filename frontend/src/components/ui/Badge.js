const TONES = {
  neutral: 'bg-white/5 text-slate border-line-dark',
  active: 'bg-tally/10 text-tally border-tally/30',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/10 text-red-400 border-red-500/25',
};

export default function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-[11px] font-medium
        uppercase tracking-[0.04em] ${TONES[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
