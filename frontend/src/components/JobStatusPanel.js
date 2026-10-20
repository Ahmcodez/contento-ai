'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/StatusBadge';
import PipelineTimeline from '@/components/PipelineTimeline';
import { cancelJob, retryJob } from '@/lib/api/jobs';

export default function JobStatusPanel({ job, onChanged }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);
  const isActive = !['completed', 'failed', 'cancelled'].includes(job.stateGroup);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelJob(job.id);
      onChanged?.();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel this job. Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      await retryJob(job.id);
      onChanged?.(); // the job is active again, so the page needs to start polling it
    } catch (err) {
      setRetryError(err.message || 'Could not retry this job. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge stateGroup={job.stateGroup} />
            {isActive && <span className="font-mono text-[12px] tabular text-steel">{job.progressPercent}%</span>}
          </div>
          {job.errorMessage && (
            <p role="alert" className="mt-2 max-w-md text-[13px] leading-relaxed text-tally">{job.errorMessage}</p>
          )}
          {cancelError && (
            <p role="alert" className="mt-2 max-w-md text-[13px] leading-relaxed text-tally">{cancelError}</p>
          )}
          {retryError && (
            <p role="alert" className="mt-2 max-w-md text-[13px] leading-relaxed text-tally">{retryError}</p>
          )}
        </div>
        {isActive && (
          <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>
            Cancel
          </Button>
        )}
        {job.stateGroup === 'failed' && (
          <Button size="sm" onClick={handleRetry} loading={retrying} className="shrink-0">
            Retry
          </Button>
        )}
      </div>

      <div className="mt-8">
        <PipelineTimeline
          stateGroup={job.stateGroup}
          failed={job.stateGroup === 'failed'}
          cancelled={job.stateGroup === 'cancelled'}
        />
      </div>

      {job.stateGroup === 'failed' && (
        <p className="mt-6 text-center text-[12px] text-steel">
          Retry picks up where it stopped, so work that already finished isn&apos;t redone.
        </p>
      )}
    </Card>
  );
}
