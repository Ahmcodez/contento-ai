'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/StatusBadge';
import PipelineTimeline from '@/components/PipelineTimeline';
import { cancelJob } from '@/lib/api/jobs';

export default function JobStatusPanel({ job, onCancelled }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const isActive = !['completed', 'failed', 'cancelled'].includes(job.stateGroup);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelJob(job.id);
      onCancelled?.();
    } catch (err) {
      setCancelError(err.message || 'Could not cancel this job. Please try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge stateGroup={job.stateGroup} />
            {isActive && <span className="font-mono text-[12px] tabular text-slate-dim">{job.progressPercent}%</span>}
          </div>
          {job.errorMessage && (
            <p role="alert" className="mt-2 max-w-md text-[13px] leading-relaxed text-tally">{job.errorMessage}</p>
          )}
          {cancelError && (
            <p role="alert" className="mt-2 max-w-md text-[13px] leading-relaxed text-tally">{cancelError}</p>
          )}
        </div>
        {isActive && (
          <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>
            Cancel
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
        <p className="mt-6 text-center text-[12px] text-slate-dim">
          Retrying a failed job isn&apos;t available yet — start a new upload to try again.
        </p>
      )}
    </Card>
  );
}
