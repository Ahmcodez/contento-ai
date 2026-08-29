export default function Card({ className = '', children, as: Component = 'div', interactive = false, ...props }) {
  return (
    <Component
      className={`rounded-lg border border-line-dark bg-surface-dark
        ${interactive ? 'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-slate/70 hover:shadow-[0_12px_28px_-16px_rgba(0,0,0,0.6)]' : ''}
        ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
