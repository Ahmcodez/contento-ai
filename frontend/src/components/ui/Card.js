export default function Card({ className = '', children, as: Component = 'div', interactive = false, variant = 'dark', ...props }) {
  // 'dark' (default) keeps every existing usage identical. 'plain' skips
  // the built-in bg/border so a caller can supply its own — needed
  // because two same-specificity Tailwind utilities (e.g. this
  // component's bg-surface-dark vs. a caller's bg-graphite) don't
  // reliably override by JSX string order alone.
  const base = variant === 'plain' ? 'rounded-lg' : 'rounded-lg border border-line-dark bg-surface-dark';

  return (
    <Component
      className={`${base}
        ${interactive ? 'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-slate/70 hover:shadow-[0_12px_28px_-16px_rgba(0,0,0,0.6)]' : ''}
        ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
