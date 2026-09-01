'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatTimecode, formatScore } from '@/lib/format';
import { downloadClip } from '@/lib/api/clips';

const RENDER_LABELS = {
  pending: 'Queued to render',
  rendering: 'Rendering…',
  rendered: null,
  failed: 'Render failed',
};

function scoreTone(score) {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  return 'neutral';
}

export default function ClipCard({ clip }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const durationMs = clip.endMs - clip.startMs;
  const isRendered = clip.render.status === 'rendered';

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadClip(clip.id, `${clip.title}.mp4`);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card interactive className="flex flex-col p-4">
      {/* 9:16 placeholder frame — clip preview streaming/playback is a
          real capability the backend supports via download, but there's
          no inline-preview streaming endpoint yet, so this shows clip
          metadata rather than fabricating a video player against a URL
          that doesn't exist. */}
      <div className="flex aspect-[9/16] items-center justify-center rounded-[3px] bg-black/40">
        <span className="font-mono text-[12px] tabular text-slate-dim">
          {formatTimecode(0)} – {formatTimecode(durationMs)}
        </span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <h4 className="text-[14px] font-medium leading-snug text-paper">{clip.title}</h4>
        {clip.qualityScore !== null && (
          <Badge tone={scoreTone(clip.qualityScore)} className="shrink-0">
            {formatScore(clip.qualityScore)}
          </Badge>
        )}
      </div>

      {clip.hook && <p className="mt-1.5 text-[13px] italic leading-relaxed text-slate">&ldquo;{clip.hook}&rdquo;</p>}

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-dim">
        <span className="font-mono tabular">
          {formatTimecode(clip.startMs)} → {formatTimecode(clip.endMs)}
        </span>
        {clip.topic && <span>{clip.topic}</span>}
      </div>

      <div className="mt-4">
        {isRendered ? (
          <>
            <Button size="sm" variant="secondary" onClick={handleDownload} loading={downloading} className="w-full">
              Download
            </Button>
            {downloadError && <p className="mt-2 text-[12px] text-tally">{downloadError}</p>}
          </>
        ) : (
          <Badge tone={clip.render.status === 'failed' ? 'danger' : 'neutral'} className="w-full justify-center py-1.5">
            {RENDER_LABELS[clip.render.status] || clip.render.status}
          </Badge>
        )}
      </div>

      {/* Manual re-render/edit isn't a real backend capability yet
          (no PATCH /clips/:id or POST /clips/:id/render endpoint) — no
          edit/regenerate button is shown here rather than a fake one. */}
    </Card>
  );
}
