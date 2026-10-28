'use client';

import { useEffect, useRef, useState } from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatTimecode, formatScore } from '@/lib/format';
import { downloadClip, getClipPlayback } from '@/lib/api/clips';

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

// Only one clip plays at a time: starting one pauses whichever was playing.
let activeVideo = null;

export default function ClipCard({ clip }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [playback, setPlayback] = useState(null); // { streamUrl, posterUrl }
  const [playbackError, setPlaybackError] = useState(null);
  const cardRef = useRef(null);
  const videoRef = useRef(null);
  const retriedRef = useRef(false);
  // Set when a link dies mid-use: where to carry on from once the replacement loads.
  const resumeRef = useRef(null);
  const durationMs = clip.endMs - clip.startMs;
  const isRendered = clip.render.status === 'rendered';

  // Ask for the playback link only when the card is about to be seen, not for every clip
  // on page load. (No video bytes are fetched until Play: the <video> uses preload="none".)
  useEffect(() => {
    if (!isRendered) return undefined;
    let cancelled = false;
    const load = () =>
      getClipPlayback(clip.id)
        .then((p) => !cancelled && setPlayback(p))
        .catch((err) => !cancelled && setPlaybackError(err.message));

    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(cardRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [clip.id, isRendered]);

  useEffect(
    () => () => {
      if (activeVideo && activeVideo === videoRef.current) activeVideo = null;
    },
    [],
  );

  // A link lasts about an hour. If the tab sat open past that, the first failure asks for
  // a fresh one and carries on from the same moment; a second failure is reported honestly.
  function handleVideoError() {
    if (retriedRef.current) {
      setPlaybackError('This clip could not be played here. You can still download it.');
      return;
    }
    retriedRef.current = true;
    // The error only happens when the viewer pressed play (nothing loads before that), so
    // they want it playing: start the replacement from the same moment without a second press.
    resumeRef.current = { at: videoRef.current?.currentTime || 0 };
    getClipPlayback(clip.id)
      .then(setPlayback)
      .catch((err) => setPlaybackError(err.message));
  }

  // After a replacement link arrives, carry on from where the viewer was. With preload="none"
  // a new source doesn't load until play() is called, so this calls it (waiting for
  // loadedmetadata would wait forever). Browsers that refuse a scripted play() just leave
  // the clip paused, ready for the viewer to press play again.
  useEffect(() => {
    const resume = resumeRef.current;
    const video = videoRef.current;
    if (!resume || !video || !playback) return;
    resumeRef.current = null;
    if (resume.at > 0) {
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.currentTime = resume.at;
        },
        { once: true },
      );
    }
    video.play().catch(() => {});
  }, [playback]);

  function handlePlay(e) {
    if (activeVideo && activeVideo !== e.currentTarget) activeVideo.pause();
    activeVideo = e.currentTarget;
  }

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
      <div ref={cardRef} className="aspect-[9/16] overflow-hidden rounded-lg bg-black">
        {playback ? (
          <video
            ref={videoRef}
            src={playback.streamUrl}
            poster={playback.posterUrl || undefined}
            controls
            playsInline
            preload="none"
            aria-label={`Clip: ${clip.title}`}
            onPlay={handlePlay}
            onError={handleVideoError}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
            <span className="font-mono text-[12px] tabular text-steel">
              {formatTimecode(0)} – {formatTimecode(durationMs)}
            </span>
            {playbackError && <span className="text-[11px] leading-snug text-steel">Preview unavailable</span>}
          </div>
        )}
      </div>
      {playbackError && playback && <p className="mt-2 text-[12px] text-tally">{playbackError}</p>}

      <div className="mt-3 flex items-start justify-between gap-2">
        <h4 className="text-[14px] font-medium leading-snug text-graphite">{clip.title}</h4>
        {clip.qualityScore !== null && (
          <Badge tone={scoreTone(clip.qualityScore)} className="shrink-0">
            {formatScore(clip.qualityScore)}
          </Badge>
        )}
      </div>

      {clip.hook && <p className="mt-1.5 text-[13px] italic leading-relaxed text-steel">&ldquo;{clip.hook}&rdquo;</p>}

      <div className="mt-3 flex items-center justify-between text-[11px] text-steel">
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
