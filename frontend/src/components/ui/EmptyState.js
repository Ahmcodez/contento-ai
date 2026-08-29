export default function EmptyState({ title, description, action, icon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed border-line-dark px-6 py-16 text-center">
      {icon && <div className="text-slate">{icon}</div>}
      <p className="font-display text-lg text-paper">{title}</p>
      {description && <p className="max-w-sm text-sm leading-relaxed text-slate">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
