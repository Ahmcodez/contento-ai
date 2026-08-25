import Badge from '@/components/ui/Badge';

// Mirrors backend/src/services/job.service.js STATE_GROUPS exactly —
// the frontend never invents its own status taxonomy.
const GROUP_LABELS = {
  uploading: 'Uploading',
  preparing: 'Preparing',
  transcribing: 'Transcribing',
  analyzing: 'Analyzing',
  rendering: 'Rendering clips',
  writing: 'Writing content',
  finishing: 'Finishing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};

const GROUP_TONES = {
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export default function StatusBadge({ stateGroup, className }) {
  const tone = GROUP_TONES[stateGroup] || 'active';
  const isLive = !['completed', 'failed', 'cancelled'].includes(stateGroup);
  return (
    <Badge tone={tone} dot={isLive} className={className}>
      {GROUP_LABELS[stateGroup] || stateGroup}
    </Badge>
  );
}
