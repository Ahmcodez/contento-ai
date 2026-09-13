'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getUrlImport } from '@/lib/api/urlImport';

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED']);
// WAITING_CONFIRMATION is a stopping point too, but not "terminal" in the
// failed/completed sense — the caller (PasteUrlImport) explicitly calls
// resumePolling() once the user confirms, rather than this hook treating
// WAITING_CONFIRMATION as done and never checking again.
const PAUSE_STATES = new Set(['WAITING_CONFIRMATION', ...TERMINAL_STATES]);

/**
 * Polls GET /media-imports/:id on an interval, same
 * poll-while-visible/stop-when-settled approach as useJobStatus.js
 * (docs/adr/008-polling-over-websockets-for-status.md applies equally
 * here) — pauses once the import reaches WAITING_CONFIRMATION (nothing
 * changes server-side until the user acts) or a truly terminal state.
 */
export function useMediaImportStatus(mediaImportId, { intervalMs = 2000 } = {}) {
  const [mediaImport, setMediaImport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const tickRef = useRef(() => {});

  const fetchOnce = useCallback(async () => {
    if (!mediaImportId) return undefined;
    try {
      const data = await getUrlImport(mediaImportId);
      setMediaImport(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mediaImportId]);

  useEffect(() => {
    if (!mediaImportId) return undefined;
    let cancelled = false;

    async function tick() {
      if (document.hidden) {
        timerRef.current = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const data = await fetchOnce();
        if (!cancelled && data && !PAUSE_STATES.has(data.state)) {
          timerRef.current = setTimeout(tick, intervalMs);
        }
      } catch {
        if (!cancelled) {
          timerRef.current = setTimeout(tick, intervalMs);
        }
      }
    }
    tickRef.current = tick;

    function handleVisibilityChange() {
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
  }, [mediaImportId, intervalMs, fetchOnce]);

  /** Call right after confirmImport() succeeds to resume polling past WAITING_CONFIRMATION. */
  function resumePolling() {
    if (timerRef.current) clearTimeout(timerRef.current);
    tickRef.current();
  }

  return {
    mediaImport,
    error,
    loading,
    isTerminal: mediaImport ? TERMINAL_STATES.has(mediaImport.state) : false,
    refetch: fetchOnce,
    resumePolling,
  };
}
