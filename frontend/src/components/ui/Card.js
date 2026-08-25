export default function Card({ className = '', children, as: Component = 'div', ...props }) {
  return (
    <Component
      className={`rounded-[4px] border border-line-dark bg-surface-dark ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
