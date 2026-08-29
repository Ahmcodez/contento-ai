'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Skeleton from '@/components/ui/Skeleton';
import ErrorState from '@/components/ui/ErrorState';
import Tabs from '@/components/ui/Tabs';
import JobStatusPanel from '@/components/JobStatusPanel';
import TranscriptPanel from '@/components/TranscriptPanel';
import ClipsPanel from '@/components/ClipsPanel';
import ContentPanel from '@/components/ContentPanel';
import { useJobStatus } from '@/lib/hooks/useJobStatus';

const WORKSPACE_TABS = [
  { id: 'clips', label: 'Clips' },
  { id: 'content', label: 'Content' },
  { id: 'transcript', label: 'Transcript' },
];

export default function JobDetailPage() {
  const { jobId } = useParams();
  const { job, error, loading, refetch } = useJobStatus(jobId);
  const [activeTab, setActiveTab] = useState('clips');

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !job) {
    return <ErrorState title="Couldn't load this job" message={error.message} onRetry={refetch} />;
  }

  const isActive = !['completed', 'failed', 'cancelled'].includes(job.stateGroup);

  return (
    <div className="flex flex-col gap-6">
      <JobStatusPanel job={job} onCancelled={refetch} />

      <div>
        <Tabs tabs={WORKSPACE_TABS} active={activeTab} onChange={setActiveTab} />
        <div className="mt-6">
          {activeTab === 'clips' && <ClipsPanel jobId={jobId} jobIsActive={isActive} />}
          {activeTab === 'content' && <ContentPanel jobId={jobId} jobIsActive={isActive} />}
          {activeTab === 'transcript' && <TranscriptPanel jobId={jobId} />}
        </div>
      </div>
    </div>
  );
}
