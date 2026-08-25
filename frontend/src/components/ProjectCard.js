import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/StatusBadge';
import { formatRelativeTime } from '@/lib/format';

// Mirrors backend/src/services/job.service.js STATE_GROUPS.
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

export default function ProjectCard({ project }) {
  const stateGroup = project.latest_job ? STATE_TO_GROUP[project.latest_job.state] : null;

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="group p-5 transition-colors hover:border-slate">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg text-paper">{project.title}</h3>
          {stateGroup && <StatusBadge stateGroup={stateGroup} />}
        </div>
        {project.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate">{project.description}</p>
        )}
        <div className="mt-4 flex items-center justify-between text-[12px] text-slate-dim">
          <span>Updated {formatRelativeTime(project.updated_at)}</span>
          {!project.latest_job && <span>No uploads yet</span>}
        </div>
      </Card>
    </Link>
  );
}
