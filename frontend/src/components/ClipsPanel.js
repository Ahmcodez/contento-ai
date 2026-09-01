'use client';

import { useEffect, useState } from 'react';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ClipCard from '@/components/ClipCard';
import { getClips } from '@/lib/api/jobs';
import { useRefetchOnJobComplete } from '@/lib/hooks/useRefetchOnJobComplete';

export default function ClipsPanel({ jobId, jobIsActive }) {
  const [clips, setClips] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const data = await getClips(jobId);
      setClips(data);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Picks up clips that finished rendering after this panel first loaded.
  useRefetchOnJobComplete(jobIsActive, load);

  if (error) return <ErrorState message={error.message} onRetry={load} />;

  if (!clips) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/16]" />
        ))}
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <EmptyState
        title={jobIsActive ? 'Finding clips…' : 'No clip candidates'}
        description={
          jobIsActive
            ? 'Clip candidates show up here once analysis finishes.'
            : 'No strong short-form moments were found in this video.'
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
