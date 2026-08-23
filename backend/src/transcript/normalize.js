/**
 * Normalizes a raw TranscriptionProvider result into the canonical shape
 * every downstream stage (AI analysis, clip detection, rendering,
 * captions) depends on. This is the one place provider-specific quirks
 * (missing fields, different timestamp units, etc.) get resolved.
 */
function normalizeTranscript(raw) {
  const segments = (raw.segments || [])
    .map((s, i) => normalizeSegment(s, i))
    .filter((s) => s.endMs > s.startMs && s.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);

  const fullText = raw.fullText?.trim() || segments.map((s) => s.text).join(' ');

  return {
    fullText,
    language: raw.language || null,
    segments,
    durationMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
  };
}

function normalizeSegment(raw, index) {
  const startMs = raw.startMs !== undefined ? raw.startMs : msFromSeconds(raw.start);
  const endMs = raw.endMs !== undefined ? raw.endMs : msFromSeconds(raw.end);
  return {
    sequence: index,
    startMs: Math.round(startMs || 0),
    endMs: Math.round(endMs || 0),
    text: (raw.text || '').trim(),
    speakerLabel: raw.speakerLabel || raw.speaker || null,
    wordTimestamps: normalizeWordTimestamps(raw.words || raw.wordTimestamps),
  };
}

function msFromSeconds(seconds) {
  return typeof seconds === 'number' ? seconds * 1000 : 0;
}

function normalizeWordTimestamps(words) {
  if (!Array.isArray(words) || words.length === 0) return null;
  return words.map((w) => {
    const startMs = w.startMs !== undefined ? w.startMs : msFromSeconds(w.start);
    const endMs = w.endMs !== undefined ? w.endMs : msFromSeconds(w.end);
    return { word: w.word ?? w.text, startMs: Math.round(startMs || 0), endMs: Math.round(endMs || 0) };
  });
}

/**
 * Finds every transcript segment overlapping [startMs, endMs) — used by
 * both clip rendering (to know which captions apply) and manual clip
 * bound editing (to preview what text falls inside the new bounds).
 */
function segmentsInRange(segments, startMs, endMs) {
  return segments.filter((s) => s.startMs < endMs && s.endMs > startMs);
}

module.exports = { normalizeTranscript, segmentsInRange };
