'use client';

import { useEffect, useState } from 'react';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import ClipCard from '@/components/ClipCard';
import { getClips } from '@/lib/api/jobs';
import { useRefetchOnJobComplete } from '@/lib/hooks/useRefetchOnJobComplete';
import { STOPPED_COPY } from '@/lib/jobCopy';

export default function ClipsPanel({ jobId, jobIsActive, jobStopped, requestedClipCount }) {
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
        title={jobIsActive ? 'Finding clips…' : jobStopped ? STOPPED_COPY[jobStopped].title : 'No clip candidates'}
        description={
          jobIsActive
            ? 'Clip candidates show up here once analysis finishes.'
            : jobStopped
              ? STOPPED_COPY[jobStopped].description
              : 'No strong short-form moments were found in this video.'
        }
      />
    );
  }

  // Be upfront when fewer clips came back than were asked for. Clips below the quality
  // bar are skipped on purpose rather than padded in, so this is expected, not an error.
  const fewerThanAsked = !jobIsActive && requestedClipCount && clips.length < requestedClipCount;

  return (
    <div>
      {fewerThanAsked && (
        <p className="mb-4 rounded-lg border border-mist bg-mist/30 px-4 py-3 text-[13px] leading-relaxed text-steel">
          Found {clips.length} strong {clips.length === 1 ? 'clip' : 'clips'} (you asked for {requestedClipCount}). Moments
          that weren&apos;t good enough on their own aren&apos;t made, so you can get fewer than you asked for.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} />
        ))}
      </div>
    </div>
  );
}
