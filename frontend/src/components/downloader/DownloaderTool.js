'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { fetchVideoInfo, startDownload, getDownloadStatus, downloadFileUrl } from '@/lib/api/downloader';

const POLL_MS = 1500;
const GIVE_UP_AFTER_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/**
 * Paste a link -> pick a format -> wait while the file is prepared -> download it.
 * Works without an account. The server does the heavy lifting in the background, so this polls
 * for the result rather than holding one long request open (which mobile networks drop).
 */
export default function DownloaderTool({ placeholder = 'Paste a video link here', idPrefix = 'dl', tone = 'card' }) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | looking | choose | starting | preparing | ready | error
  const [info, setInfo] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const stopRef = useRef(false);

  useEffect(
    () => () => {
      stopRef.current = true; // stop polling if the visitor leaves the page
    },
    [],
  );

  function reset() {
    stopRef.current = true;
    setUrl('');
    setPhase('idle');
    setInfo(null);
    setSelectedId(null);
    setJob(null);
    setError(null);
  }

  function fail(message) {
    setError(message);
    setPhase('error');
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // Clipboard access can be refused (permissions, Firefox). Typing or Ctrl+V still works.
    }
  }

  async function handleLookup(e) {
    e.preventDefault();
    const value = url.trim();
    if (!value) return fail('Paste the link of the video you want to download.');
    stopRef.current = false;
    setError(null);
    setPhase('looking');
    try {
      const data = await fetchVideoInfo(value);
      setInfo(data);
      const preferred = data.options.find((o) => o.height === 720) || data.options.find((o) => o.kind === 'video') || data.options[0];
      setSelectedId(preferred.id);
      setPhase('choose');
    } catch (err) {
      fail(err.message || 'We couldn\u2019t read that link. Check it and try again.');
    }
  }

  async function handleDownload() {
    setPhase('starting');
    setError(null);
    try {
      const { id } = await startDownload(url.trim(), selectedId);
      setPhase('preparing');
      const startedAt = Date.now();
       
      while (true) {
         
        await sleep(POLL_MS);
        if (stopRef.current) return;
         
        const status = await getDownloadStatus(id);
        if (stopRef.current) return;
        if (status.state === 'ready') {
          setJob(status);
          setPhase('ready');
          return;
        }
        if (status.state === 'failed') return fail(status.error || 'The video could not be downloaded right now.');
        if (status.state === 'expired') return fail('This download expired. Please start it again.');
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) return fail('This is taking longer than expected. Please try again, or pick a lower quality.');
      }
    } catch (err) {
      return fail(err.message || 'Something went wrong. Please try again.');
    }
  }

  const busy = phase === 'looking' || phase === 'starting' || phase === 'preparing';
  const shell = tone === 'card' ? 'rounded-3xl border border-mist bg-white p-4 shadow-sm sm:p-6' : '';

  return (
    <div className={shell}>
      <form onSubmit={handleLookup} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={`${idPrefix}-url`} className="sr-only">
          Video link
        </label>
        <div className="flex min-w-0 flex-1 items-center rounded-full border border-mist bg-white pr-2 focus-within:border-accent-violet">
          <input
            id={`${idPrefix}-url`}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
            className="min-w-0 flex-1 rounded-full bg-transparent px-5 py-3 text-sm text-graphite placeholder:text-steel/70 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={pasteFromClipboard}
            disabled={busy}
            className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-steel hover:bg-mist/50 hover:text-graphite disabled:opacity-50"
          >
            Paste
          </button>
        </div>
        <Button type="submit" variant="gradientPill" size="lg" loading={phase === 'looking'} disabled={busy} className="sm:shrink-0">
          Get video
        </Button>
      </form>

      <div aria-live="polite" className="mt-4">
        {phase === 'error' && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800">
            {error}
            <button type="button" onClick={() => setPhase(info ? 'choose' : 'idle')} className="ml-2 font-medium underline">
              Try again
            </button>
          </div>
        )}

        {(phase === 'choose' || phase === 'starting' || phase === 'preparing') && info && (
          <div className="rounded-2xl border border-mist bg-white p-4 text-left">
            <div className="flex gap-4">
              {info.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={info.thumbnailUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="h-20 w-36 shrink-0 rounded-lg bg-mist object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 break-words text-sm font-semibold text-graphite">{info.title}</p>
                <p className="mt-1 text-[12px] capitalize text-steel">
                  {[info.provider === 'twitter' ? 'X (Twitter)' : info.provider, formatDuration(info.durationSeconds)].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            <fieldset disabled={phase !== 'choose'} className="mt-4 min-w-0 border-0 p-0">
              <legend className="text-[13px] font-medium text-graphite">Choose a format</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {info.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selectedId === option.id}
                    onClick={() => setSelectedId(option.id)}
                    className={`rounded-full border px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60
                      ${selectedId === option.id ? 'border-graphite bg-graphite text-white' : 'border-mist bg-white text-graphite hover:border-steel'}`}
                  >
                    {option.label}
                    {option.approxSizeLabel && <span className="ml-1.5 font-normal opacity-70">{option.approxSizeLabel}</span>}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={handleDownload} variant="gradientPill" loading={phase === 'starting' || phase === 'preparing'} disabled={phase !== 'choose'}>
                {phase === 'preparing' ? 'Preparing your file…' : 'Download'}
              </Button>
              {phase === 'preparing' && <span className="text-[13px] text-steel">This usually takes under a minute. Keep this page open.</span>}
            </div>
          </div>
        )}

        {phase === 'ready' && job && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-left">
            <p className="text-sm font-semibold text-graphite">Your file is ready</p>
            <p className="mt-1 break-words text-[13px] text-steel">
              {job.filename}
              {job.sizeBytes ? ` · ${formatBytes(job.sizeBytes)}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={downloadFileUrl(job.id)}
                className="inline-flex h-12 items-center justify-center rounded-full bg-brand-gradient px-7 text-[15px] font-medium text-white shadow-pill-glow hover:brightness-110"
              >
                Download file
              </a>
              <button type="button" onClick={reset} className="text-[13px] font-medium text-steel underline hover:text-graphite">
                Download another video
              </button>
            </div>
            <p className="mt-3 text-[12px] text-steel">The file is deleted from our server about 30 minutes after it is made.</p>

            <div className="mt-4 rounded-xl border border-mist bg-white px-4 py-3 text-[13px] leading-relaxed text-steel">
              Have a long video? <span className="font-medium text-graphite">Contento turns it into ranked short clips with captions</span>, plus a blog post and
              social copy.{' '}
              <Link href="/signup" className="font-medium text-graphite underline">
                Try it free
              </Link>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-steel">
        Only download videos you own or have permission to save. See our{' '}
        <Link href="/acceptable-use" className="underline hover:text-graphite">
          acceptable use and copyright policy
        </Link>
        .
      </p>
    </div>
  );
}
