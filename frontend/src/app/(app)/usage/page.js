'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import ErrorState from '@/components/ui/ErrorState';
import { getUsage } from '@/lib/api/usage';

function UsageMetric({ label, used, max, unit = '' }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <Card className="p-5">
      <p className="text-[12px] uppercase tracking-[0.06em] text-slate-dim">{label}</p>
      <p className="mt-2 font-mono text-2xl tabular text-paper">
        {used}
        {unit}
        <span className="text-base text-slate-dim"> / {max}{unit}</span>
      </p>
      <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full transition-[width] duration-300 ${pct > 90 ? 'bg-tally' : 'bg-paper'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}

export default function UsagePage() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      setUsage(await getUsage());
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState message={error.message} onRetry={load} />;

  if (!usage) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl text-paper">Usage</h1>
        <span className="rounded-[3px] border border-line-dark px-2.5 py-1 text-[12px] uppercase tracking-[0.06em] text-slate">
          {usage.plan} plan
        </span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UsageMetric label="AI requests today" used={usage.usage.aiRequestsUsedToday} max={usage.quota.maxAiRequestsPerDay} />
        <UsageMetric
          label="Active processing jobs"
          used={usage.usage.activeProcessingJobs}
          max={usage.quota.maxConcurrentJobs}
        />
        <UsageMetric
          label="Clips rendered this month"
          used={usage.usage.clipsRenderedThisMonth}
          max={usage.quota.maxClipsPerVideo * 10}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-slate">Plan limits</h2>
        <Card className="mt-3 divide-y divide-line-dark">
          {[
            ['Max upload size', `${usage.quota.maxUploadSizeMb} MB`],
            ['Max video duration', `${Math.round(usage.quota.maxUploadDurationSeconds / 60)} min`],
            ['Max clips per video', usage.quota.maxClipsPerVideo],
            ['Max AI requests per day', usage.quota.maxAiRequestsPerDay],
            ['Max concurrent processing jobs', usage.quota.maxConcurrentJobs],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-slate">{label}</span>
              <span className="font-mono tabular text-paper">{value}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
