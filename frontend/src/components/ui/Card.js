export default function Card({ className = '', children, as: Component = 'div', interactive = false, variant = 'light', ...props }) {
  // 'light' (default, since the whole product now uses the light
  // theme) — 'dark' is kept as an explicit opt-in in case a dark
  // surface is ever needed again. 'plain' skips the built-in bg/border
  // so a caller can supply its own — needed because two
  // same-specificity Tailwind utilities (e.g. this component's default
  // bg vs. a caller's bg-graphite) don't reliably override by JSX
  // string order alone.
  const base =
    variant === 'plain'
      ? 'rounded-lg'
      : variant === 'dark'
        ? 'rounded-lg border border-line-dark bg-surface-dark'
        : 'rounded-lg border border-mist bg-white';

  const hoverStyles =
    variant === 'dark'
      ? 'hover:border-slate/70 hover:shadow-[0_12px_28px_-16px_rgba(0,0,0,0.6)]'
      : 'hover:border-accent-violet/30 hover:shadow-lg hover:shadow-slate-900/5';

  return (
    <Component
      className={`${base}
        ${interactive ? `transition-all duration-200 ease-out hover:-translate-y-0.5 ${hoverStyles}` : ''}
        ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
