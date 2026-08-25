'use client';

export default function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`flex items-center gap-1 border-b border-line-dark ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35
              ${isActive ? 'text-paper' : 'text-slate hover:text-paper disabled:hover:text-slate'}`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 font-mono text-[11px] tabular text-slate">{tab.count}</span>
            )}
            {isActive && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-tally" />}
          </button>
        );
      })}
    </div>
  );
}
