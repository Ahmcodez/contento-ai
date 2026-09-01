'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getJob } from '@/lib/api/jobs';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * Polls GET /jobs/:id on an interval until the job reaches a terminal
 * state (docs/adr/008-polling-over-websockets-for-status.md). Polls
 * faster while actively processing, stops entirely once terminal.
 */
export function useJobStatus(jobId, { intervalMs = 3000 } = {}) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchOnce = useCallback(async () => {
    if (!jobId) return;
    try {
      const data = await getJob(jobId);
      setJob(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;

    async function tick() {
      // Skip this cycle's fetch entirely while the tab is backgrounded —
      // there's no one watching the progress bar, so there's no reason
      // to keep polling the API at full rate. The visibilitychange
      // listener below catches back up immediately once it's visible
      // again, so nothing is missed, it's just not fetched needlessly.
      if (document.hidden) {
        timerRef.current = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const data = await fetchOnce();
        if (!cancelled && data && !TERMINAL_STATES.has(data.state)) {
          timerRef.current = setTimeout(tick, intervalMs);
        }
      } catch {
        // fetchOnce already recorded the error; retry on the same interval
        // rather than hammering a failing endpoint faster.
        if (!cancelled) {
          timerRef.current = setTimeout(tick, intervalMs);
        }
      }
    }

    function handleVisibilityChange() {
      // Coming back to the tab: refresh right away instead of waiting out
      // whatever's left of the current interval, so the status shown
      // isn't stale from whenever the tab was last focused.
      if (!document.hidden && !cancelled) {
        if (timerRef.current) clearTimeout(timerRef.current);
        tick();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    tick();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId, intervalMs, fetchOnce]);

  return { job, error, loading, isTerminal: job ? TERMINAL_STATES.has(job.state) : false, refetch: fetchOnce };
}
