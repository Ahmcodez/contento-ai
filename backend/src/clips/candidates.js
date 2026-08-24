const config = require('../config');
const { scoreClipCandidate } = require('./scoring');

/**
 * Takes raw AI-proposed clip candidates and the real transcript, and
 * produces the final, trustworthy set of candidates — clamping
 * timestamps to valid bounds, merging overlaps, enforcing duration and
 * count limits, and scoring each one. This is the concrete
 * implementation of docs/AI.md §4 "AI proposes, code disposes": nothing
 * from the AI response reaches the database or FFmpeg without passing
 * through here first.
 */
function processClipCandidates(rawCandidates, { transcript, durationMs }) {
  const clamped = rawCandidates
    .map((c) => clampCandidate(c, durationMs))
    .filter((c) => c !== null)
    .filter((c) => durationWithinBounds(c.endMs - c.startMs));

  const merged = mergeOverlapping(clamped);

  const limited = merged
    .map((c) => attachTranscriptContext(c, transcript))
    .map((c) => ({ ...c, ...scoreClipCandidate(c) }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, config.limits.maxClipsPerVideo);

  return limited;
}

function clampCandidate(raw, durationMs) {
  if (!Number.isFinite(raw.startMs) || !Number.isFinite(raw.endMs)) return null;

  const startMs = Math.max(0, Math.min(raw.startMs, durationMs));
  const endMs = Math.max(0, Math.min(raw.endMs, durationMs));

  if (endMs <= startMs) return null;

  return {
    startMs,
    endMs,
    title: (raw.title || 'Untitled clip').slice(0, 200),
    hook: raw.hook?.slice(0, 500),
    summary: raw.summary?.slice(0, 1000),
    reason: raw.reason?.slice(0, 500),
    topic: raw.topic?.slice(0, 200),
    aiScore: raw.estimatedQualityScore,
  };
}

function durationWithinBounds(durationMs) {
  const seconds = durationMs / 1000;
  // Allow some slack below/above the configured ideal range rather than
  // hard-rejecting — the scoring model already penalizes off-range
  // duration (scoring.js scoreDurationFit), so outright rejection is
  // reserved for genuinely unusable clips (near-zero or absurdly long).
  return seconds >= 3 && seconds <= config.limits.clipMaxDurationSeconds * 2;
}

/**
 * Merges candidates whose time ranges overlap by more than 50% of the
 * shorter one — the AI sometimes proposes near-duplicate clips for the
 * same moment; keeping both would waste render budget and confuse the
 * user with duplicate suggestions.
 */
function mergeOverlapping(candidates) {
  const sorted = [...candidates].sort((a, b) => a.startMs - b.startMs);
  const result = [];

  for (const candidate of sorted) {
    const last = result[result.length - 1];
    if (last && overlapsSignificantly(last, candidate)) {
      // Keep whichever one has more AI-provided detail (a proxy for the
      // AI having "tried harder" on that candidate); ties keep the first.
      if (candidateRichness(candidate) > candidateRichness(last)) {
        result[result.length - 1] = candidate;
      }
      continue;
    }
    result.push(candidate);
  }

  return result;
}

function overlapsSignificantly(a, b) {
  const overlapStart = Math.max(a.startMs, b.startMs);
  const overlapEnd = Math.min(a.endMs, b.endMs);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  const shorterDurationMs = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  return shorterDurationMs > 0 && overlapMs / shorterDurationMs > 0.5;
}

function candidateRichness(candidate) {
  return [candidate.hook, candidate.summary, candidate.reason].filter(Boolean).length;
}

/**
 * Pulls the actual transcript text covering the clip bounds and checks
 * whether the bounds land on real segment boundaries — both needed by
 * the scoring model (scoring.js) and by caption generation later.
 */
function attachTranscriptContext(candidate, transcript) {
  const segments = transcript.segments.filter((s) => s.startMs < candidate.endMs && s.endMs > candidate.startMs);
  const text = segments.map((s) => s.text).join(' ');

  const startsOnBoundary = segments.length > 0 && Math.abs(segments[0].startMs - candidate.startMs) < 500;
  const endsOnBoundary = segments.length > 0 && Math.abs(segments[segments.length - 1].endMs - candidate.endMs) < 500;

  return { ...candidate, text, startsOnBoundary, endsOnBoundary };
}

module.exports = { processClipCandidates, clampCandidate, mergeOverlapping };
