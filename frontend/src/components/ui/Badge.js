const TONES = {
  neutral: 'bg-white/5 text-slate border-line-dark',
  active: 'bg-tally/10 text-tally border-tally/30',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/10 text-red-400 border-red-500/25',
};

// Redesign-phase: same semantics, but the *-400 shades above are only
// legible on a dark surface (contrast fails on white). Used wherever a
// Badge sits on one of the new light marketing sections.
const TONES_LIGHT = {
  neutral: 'bg-mist/60 text-steel border-mist',
  active: 'bg-accent-magenta/10 text-accent-magenta border-accent-magenta/25',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
};

export default function Badge({ tone = 'neutral', dot = false, surface = 'light', className = '', children }) {
  const tones = surface === 'dark' ? TONES : TONES_LIGHT;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-[11px] font-medium
        uppercase tracking-[0.04em] ${tones[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
