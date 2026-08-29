import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/StatusBadge';
import { formatDuration, formatRelativeTime } from '@/lib/format';

const STATE_TO_GROUP = {
  UPLOADING: 'uploading',
  UPLOADED: 'uploading',
  VALIDATING: 'preparing',
  VALIDATED: 'preparing',
  EXTRACTING_AUDIO: 'preparing',
  AUDIO_EXTRACTED: 'preparing',
  TRANSCRIBING: 'transcribing',
  TRANSCRIBED: 'transcribing',
  ANALYZING: 'analyzing',
  ANALYZED: 'analyzing',
  FINDING_CLIPS: 'analyzing',
  CLIPS_FOUND: 'analyzing',
  SCORING_CLIPS: 'analyzing',
  CLIPS_SCORED: 'analyzing',
  RENDERING_CLIPS: 'rendering',
  CLIPS_RENDERED: 'rendering',
  GENERATING_CONTENT: 'writing',
  CONTENT_GENERATED: 'writing',
  FINALIZING: 'finishing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export default function MediaAssetRow({ projectId, asset }) {
  const content = (
    <Card className="flex items-center justify-between gap-4 p-4 transition-colors hover:border-slate">
      <div className="min-w-0">
        <p className="truncate text-sm text-paper">{asset.originalFilename}</p>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-slate-dim">
          <span>{formatRelativeTime(asset.createdAt)}</span>
          {asset.durationSeconds && <span>{formatDuration(asset.durationSeconds)}</span>}
        </div>
      </div>
      {asset.latestJob && <StatusBadge stateGroup={STATE_TO_GROUP[asset.latestJob.state]} />}
    </Card>
  );

  if (!asset.latestJob) return content;

  return <Link href={`/projects/${projectId}/jobs/${asset.latestJob.id}`}>{content}</Link>;
}
