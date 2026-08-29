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
    <Link href={`/projects/${project.id}`} className="group block">
      <Card interactive className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg text-paper">{project.title}</h3>
          {stateGroup && <StatusBadge stateGroup={stateGroup} />}
        </div>
        {project.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate">{project.description}</p>
        )}
        <div className="mt-4 flex items-center justify-between text-[12px] text-slate-dim">
          <span>Updated {formatRelativeTime(project.updated_at)}</span>
          {!project.latest_job ? (
            <span>No uploads yet</span>
          ) : (
            <span
              aria-hidden="true"
              className="flex items-center gap-1 text-slate opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100"
            >
              Open
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6h7M6 2.5 9.5 6 6 9.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
