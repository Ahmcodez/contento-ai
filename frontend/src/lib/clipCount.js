// How many clips to ask for. MAX mirrors the server's MAX_CLIPS_PER_VIDEO default; the
// server is the authority and rejects anything above its own limit with a readable message.
export const DEFAULT_CLIP_COUNT = 5;
export const MAX_CLIP_COUNT = 20;
export const CLIP_COUNT_PRESETS = [3, 5, 8, 10, 15];

/** Whole number inside 1..MAX, or null for blank / not-a-number (so the field can be empty while typing). */
export function parseClipCount(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return Math.min(MAX_CLIP_COUNT, Math.max(1, n));
}
