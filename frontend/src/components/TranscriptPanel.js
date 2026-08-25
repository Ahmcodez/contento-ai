'use client';

import { useEffect, useState } from 'react';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { getTranscript } from '@/lib/api/jobs';
import { formatTimecode } from '@/lib/format';
import { ApiError } from '@/lib/api/client';

export default function TranscriptPanel({ jobId }) {
  const [transcript, setTranscript] = useState(null);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    setNotReady(false);
    try {
      const data = await getTranscript(jobId);
      setTranscript(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_READY') {
        setNotReady(true);
      } else {
        setError(err);
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (error) return <ErrorState message={error.message} onRetry={load} />;

  if (notReady) {
    return (
      <EmptyState
        title="Transcript not ready yet"
        description="This shows up once the audio has been transcribed. It usually takes a minute or two after upload."
      />
    );
  }

  if (!transcript) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${70 + ((i * 13) % 25)}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {transcript.segments.map((segment, i) => (
        <div key={i} className="flex gap-4 rounded-[3px] px-2 py-1.5 hover:bg-white/[0.03]">
          <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] tabular text-slate-dim">
            {formatTimecode(segment.startMs)}
          </span>
          <p className="text-[14px] leading-relaxed text-paper/90">{segment.text}</p>
        </div>
      ))}
    </div>
  );
}
