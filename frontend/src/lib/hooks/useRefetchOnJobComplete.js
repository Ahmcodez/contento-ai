'use client';

import { useEffect, useRef } from 'react';

/**
 * ClipsPanel/ContentPanel/TranscriptPanel each fetch once on mount and
 * never again. That's fine if the job was already finished when the page
 * loaded, but if someone opens the job page while it's still processing
 * and just waits there, whatever was fetched at mount (usually the
 * "still working on it" empty state) never gets refreshed — the user has
 * to manually reload the page to see clips/content/transcript that
 * finished generating after they arrived.
 *
 * This calls `refetch` exactly once, the moment `jobIsActive` flips from
 * true to false (i.e. the job just reached a terminal state), so results
 * that finished while the tab was open actually show up on their own.
 */
export function useRefetchOnJobComplete(jobIsActive, refetch) {
  const wasActiveRef = useRef(jobIsActive);

  useEffect(() => {
    if (wasActiveRef.current && !jobIsActive) {
      refetch();
    }
    wasActiveRef.current = jobIsActive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIsActive]);
}
