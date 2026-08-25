'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import { getUsage } from '@/lib/api/usage';

function UsageRow({ label, used, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-slate">{label}</span>
        <span className="font-mono tabular text-paper">
          {used} <span className="text-slate-dim">/ {max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full transition-[width] duration-300 ${pct > 90 ? 'bg-tally' : 'bg-paper'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function UsageSummaryCard() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getUsage()
      .then(setUsage)
      .catch(() => setError(true));
  }, []);

  if (error) return null; // usage widget is supplementary — fail quietly, don't block the dashboard

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-paper">Usage</h3>
        {usage && (
          <span className="text-[11px] uppercase tracking-[0.06em] text-slate-dim">{usage.plan} plan</span>
        )}
      </div>

      {!usage ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <UsageRow label="AI requests today" used={usage.usage.aiRequestsUsedToday} max={usage.quota.maxAiRequestsPerDay} />
          <UsageRow
            label="Active processing jobs"
            used={usage.usage.activeProcessingJobs}
            max={usage.quota.maxConcurrentJobs}
          />
        </div>
      )}
    </Card>
  );
}
