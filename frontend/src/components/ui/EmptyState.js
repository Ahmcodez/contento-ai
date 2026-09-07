export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-mist px-6 py-16 text-center">
      {icon && <div className="text-steel">{icon}</div>}
      <p className="font-jakarta text-lg text-graphite">{title}</p>
      {description && <p className="max-w-sm text-sm leading-relaxed text-steel">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
