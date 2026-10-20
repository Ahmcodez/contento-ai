'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Skeleton from '@/components/ui/Skeleton';
import ErrorState from '@/components/ui/ErrorState';
import Tabs from '@/components/ui/Tabs';
import JobStatusPanel from '@/components/JobStatusPanel';
import TranscriptPanel from '@/components/TranscriptPanel';
import ClipsPanel from '@/components/ClipsPanel';
import ContentPanel from '@/components/ContentPanel';
import { useJobStatus } from '@/lib/hooks/useJobStatus';
import { getProject } from '@/lib/api/projects';

const WORKSPACE_TABS = [
  { id: 'clips', label: 'Clips' },
  { id: 'content', label: 'Content' },
  { id: 'transcript', label: 'Transcript' },
];

export default function JobDetailPage() {
  const { projectId, jobId } = useParams();
  const { job, error, loading, refetch, restart } = useJobStatus(jobId);
  const [activeTab, setActiveTab] = useState('clips');
  const [project, setProject] = useState(null);

  // Only for the heading and the way back; the page works without it.
  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
  const jobStopped = job.stateGroup === 'failed' || job.stateGroup === 'cancelled' ? job.stateGroup : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${projectId}`} className="text-[13px] text-steel hover:text-graphite">
          ← Back to project
        </Link>
        <h1 className="mt-2 break-words font-jakarta text-2xl font-semibold text-graphite">
          {project?.title || 'Results'}
        </h1>
      </div>

      <JobStatusPanel job={job} onChanged={restart} />

      <div>
        <Tabs tabs={WORKSPACE_TABS} active={activeTab} onChange={setActiveTab} />
        <div className="mt-6">
          {activeTab === 'clips' && <ClipsPanel jobId={jobId} jobIsActive={isActive} jobStopped={jobStopped} />}
          {activeTab === 'content' && <ContentPanel jobId={jobId} jobIsActive={isActive} jobStopped={jobStopped} />}
          {activeTab === 'transcript' && <TranscriptPanel jobId={jobId} jobIsActive={isActive} jobStopped={jobStopped} />}
        </div>
      </div>
    </div>
  );
}
