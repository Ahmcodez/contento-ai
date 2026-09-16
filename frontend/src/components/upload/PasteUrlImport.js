'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
import { createUrlImport, confirmUrlImport } from '@/lib/api/urlImport';
import { useMediaImportStatus } from '@/lib/hooks/useMediaImportStatus';
import { formatDuration } from '@/lib/format';
import { ApiError } from '@/lib/api/client';

const PROVIDER_LABELS = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  tiktok: 'TikTok',
  dropbox: 'Dropbox',
  direct: 'Direct link',
};

const RESOLVING_STATES = new Set(['DETECTING_PROVIDER', 'FETCHING_METADATA']);
const IMPORTING_STATES = new Set(['DOWNLOADING', 'VALIDATING_MEDIA']);

/**
 * Paste-URL counterpart to UploadDropzone.js. Never starts real
 * processing before the user explicitly confirms the preview — pasting
 * a URL only ever triggers the cheap DETECTING_PROVIDER/FETCHING_METADATA
 * preview; the expensive download only starts from handleConfirm.
 */
export default function PasteUrlImport({ projectId, onImported }) {
  const [url, setUrl] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [mediaImportId, setMediaImportId] = useState(null);

  const { mediaImport, error: pollError, resumePolling } = useMediaImportStatus(mediaImportId);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await createUrlImport(projectId, url.trim());
      setMediaImportId(created.id);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not start the import. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    setSubmitError(null);
    try {
      await confirmUrlImport(mediaImportId);
      resumePolling();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not start the import. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  function reset() {
    setUrl('');
    setSubmitError(null);
    setMediaImportId(null);
  }

  // Fire the completion callback from an effect, never during render.
  // Calling it inline in the render path meant the parent's
  // router.push() ran while this component was still rendering, which
  // React rejects ("Cannot update a component while rendering a
  // different component") and which produces a broken navigation.
  const isComplete = mediaImport?.state === 'COMPLETED';
  const completedJobId = mediaImport?.processingJobId;
  const completedAssetId = mediaImport?.mediaAssetId;

  useEffect(() => {
    if (isComplete && completedJobId) {
      onImported({ mediaAssetId: completedAssetId, processingJobId: completedJobId });
    }
  }, [isComplete, completedJobId, completedAssetId, onImported]);

  if (isComplete) {
    return (
      <div className="rounded-lg border border-mist p-6">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-steel border-t-transparent" />
          <p className="text-sm text-graphite">Import complete — opening your project…</p>
        </div>
      </div>
    );
  }

  if (!mediaImportId) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          label="Paste video URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          required
        />
        {submitError && <p role="alert" className="text-[13px] text-tally">{submitError}</p>}
        <Button type="submit" variant="secondary" loading={submitting} className="self-start">
          Fetch preview
        </Button>
        <p className="text-[12px] text-steel">YouTube · Vimeo · TikTok · Dropbox · Direct URLs</p>
      </form>
    );
  }

  const state = mediaImport?.state;

  if (state === 'FAILED') {
    return (
      <div className="rounded-lg border border-tally/30 bg-tally/5 p-6">
        <p className="text-sm font-medium text-graphite">Couldn&apos;t import this video</p>
        <p className="mt-1 text-[13px] text-tally">{mediaImport.errorMessage || 'Something went wrong.'}</p>
        <Button variant="ghost" size="sm" onClick={reset} className="mt-4">
          Try a different URL
        </Button>
      </div>
    );
  }

  if (pollError && !mediaImport) {
    return (
      <div className="rounded-lg border border-mist p-6">
        <p className="text-sm text-tally">Couldn&apos;t check the import status.</p>
        <Button variant="ghost" size="sm" onClick={reset} className="mt-3">
          Start over
        </Button>
      </div>
    );
  }

  if (!mediaImport || RESOLVING_STATES.has(state)) {
    return (
      <div className="rounded-lg border border-mist p-6">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-steel border-t-transparent" />
          <p className="text-sm text-graphite">Fetching video details…</p>
        </div>
      </div>
    );
  }

  if (state === 'WAITING_CONFIRMATION') {
    const providerLabel = PROVIDER_LABELS[mediaImport.provider] || mediaImport.provider;
    return (
      <div className="rounded-lg border border-mist p-6">
        <div className="flex gap-4">
          {mediaImport.thumbnailUrl ? (
            // Thumbnails come from third-party sources with arbitrary
            // hosts/aspect ratios — a plain <img> avoids needing every
            // possible source domain allowlisted in next.config.js's
            // Image loader.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaImport.thumbnailUrl} alt="" className="h-20 w-32 shrink-0 rounded object-cover" />
          ) : (
            <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded bg-mist/60 text-[11px] text-steel">
              No preview
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-graphite">{mediaImport.title || 'Untitled video'}</p>
            <p className="mt-1 text-[12px] text-steel">
              {providerLabel}
              {mediaImport.durationSeconds ? ` · ${formatDuration(mediaImport.durationSeconds)}` : ''}
              {mediaImport.width && mediaImport.height ? ` · ${mediaImport.width}×${mediaImport.height}` : ''}
            </p>
          </div>
        </div>
        {submitError && <p role="alert" className="mt-3 text-[13px] text-tally">{submitError}</p>}
        <div className="mt-4 flex gap-2">
          <Button onClick={handleConfirm} loading={confirming}>
            Import &amp; Analyze
          </Button>
          <Button variant="ghost" onClick={reset}>
            Choose a different URL
          </Button>
        </div>
      </div>
    );
  }

  if (IMPORTING_STATES.has(state)) {
    return (
      <div className="rounded-lg border border-mist p-6">
        <p className="text-sm text-graphite">{mediaImport.title || 'Importing video'}</p>
        <ProgressBar
          value={mediaImport.progressPercent}
          showLabel
          label={state === 'DOWNLOADING' ? 'Downloading' : 'Validating'}
          className="mt-4"
        />
      </div>
    );
  }

  return null;
}
