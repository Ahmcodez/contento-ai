const config = require('../config');

/**
 * Clip quality/recommendation score — a weighted combination of
 * deterministic signal (duration fit, context independence, sentence
 * boundary cleanliness) and the AI's own estimate. This is deliberately
 * called a "quality score" / "recommendation", never a virality
 * guarantee (docs/PIPELINE.md §3.7) — it exists to rank candidates
 * relative to each other, not to predict real-world performance.
 *
 * Weights sum to 1.0. Kept as plain constants (not env-configurable) —
 * unlike cost/safety limits, these are a product-tuning decision meant
 * to iterate in code review, not runtime config.
 */
const WEIGHTS = {
  durationFit: 0.15,
  contextIndependence: 0.15,
  sentenceBoundary: 0.15,
  aiEstimate: 0.35,
  hookPresence: 0.1,
  conclusionPresence: 0.1,
};

/**
 * Scores how close a clip's duration is to the ideal range — full marks
 * inside [min, max], tapering linearly outside it rather than a hard cliff.
 */
function scoreDurationFit(durationMs) {
  const durationSeconds = durationMs / 1000;
  const { clipMinDurationSeconds: min, clipMaxDurationSeconds: max } = config.limits;

  if (durationSeconds >= min && durationSeconds <= max) return 100;
  if (durationSeconds < min) {
    return Math.max(0, 100 - ((min - durationSeconds) / min) * 100);
  }
  const over = durationSeconds - max;
  return Math.max(0, 100 - (over / max) * 100);
}

/**
 * Approximates "does this clip depend on context outside its own
 * bounds" by checking whether the clip text opens/closes on things that
 * read as mid-thought (starts with a conjunction/pronoun referring
 * backward, ends mid-sentence without terminal punctuation). This is a
 * heuristic, not a semantic judgment — the AI-provided reason/summary is
 * the semantic signal (folded into aiEstimate); this catches the
 * mechanical cases the AI sometimes misses.
 */
function scoreContextIndependence(text) {
  const trimmed = text.trim();
  const opensWithDependentWord = /^(and|but|so|because|which|however|therefore|also|then)\b/i.test(trimmed);
  const endsCleanly = /[.!?]["')\]]?$/.test(trimmed);

  let score = 100;
  if (opensWithDependentWord) score -= 35;
  if (!endsCleanly) score -= 25;
  return Math.max(0, score);
}

/**
 * Rewards clips whose bounds land on real sentence boundaries in the
 * transcript (avoids cutting mid-word/mid-sentence, docs/PIPELINE.md
 * §3.6). `startsOnBoundary`/`endsOnBoundary` are computed by the caller
 * by comparing the clip bounds against segment start/end timestamps.
 */
function scoreSentenceBoundary({ startsOnBoundary, endsOnBoundary }) {
  let score = 100;
  if (!startsOnBoundary) score -= 30;
  if (!endsOnBoundary) score -= 30;
  return Math.max(0, score);
}

// Phrasing that signals a generic, low-retention opening — throat-clearing
// or scene-setting rather than a real hook. Matched against the start of
// the hook text; any match is a strong negative signal.
const WEAK_OPENING_PATTERN = /^(so[, ]|today|in this video|welcome|let'?s talk about|basically|ok(ay)?[, ]|hi (everyone|guys)|hey (everyone|guys))/i;

// Phrasing/structure that correlates with the proven hook patterns in the
// clip-detection prompt (surprising claim, question, stat-led, consequence-
// first, direct address). This is a heuristic proxy, not a semantic
// judgment — the AI's own estimatedQualityScore (aiEstimate, 0.35 weight)
// is the real semantic signal; this catches the mechanical cases.
const STRONG_SIGNAL_PATTERNS = [
  /\?\s*$/, // ends as a question
  // a concrete number, digit or spelled out — AI-generated text commonly
  // spells out small numbers per standard English style ("three things"),
  // so matching only digits would miss most real cases.
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  /\b(you|your)\b/i, // direct address
  /\b(most people|turns out|actually|the truth is|nobody tells you|here'?s why|here'?s what)\b/i, // surprise/contrast framing
];

/**
 * Scores hook QUALITY, not just presence — presence alone stopped being a
 * useful signal once `hook` became a required schema field (ai/schemas.js;
 * the AI always provides *something* now, but "something" and "a real
 * hook" aren't the same thing). Checks length (a hook that's a single
 * word or a full paragraph isn't doing its job) and matches against known
 * weak-opening and strong-signal phrasing.
 */
function scoreHookPresence(hook) {
  const trimmed = (hook || '').trim();
  if (trimmed.length === 0) return 0; // schema requires this now; 0 signals a real problem upstream

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 3 || wordCount > 40) return 35; // too short to be a real claim, or too long to be punchy

  let score = 65; // baseline for a present, reasonably-sized hook with no further signal either way
  if (WEAK_OPENING_PATTERN.test(trimmed)) score -= 30;
  const strongSignalCount = STRONG_SIGNAL_PATTERNS.filter((p) => p.test(trimmed)).length;
  score += Math.min(strongSignalCount, 2) * 15; // diminishing returns past 2 signals

  return Math.max(0, Math.min(100, score));
}

function scoreConclusionPresence(text) {
  const endsWithTerminalPunctuation = /[.!?]["')\]]?$/.test(text.trim());
  return endsWithTerminalPunctuation ? 100 : 50;
}

/**
 * Computes the final 0-100 score and a breakdown so the "why this score"
 * question is always answerable (stored alongside the score, see
 * migrations/..._content_pipeline_tables.js clip_candidates.score_breakdown).
 */
function scoreClipCandidate(candidate) {
  const durationMs = candidate.endMs - candidate.startMs;

  const breakdown = {
    durationFit: scoreDurationFit(durationMs),
    contextIndependence: scoreContextIndependence(candidate.text || ''),
    sentenceBoundary: scoreSentenceBoundary({
      startsOnBoundary: candidate.startsOnBoundary ?? true,
      endsOnBoundary: candidate.endsOnBoundary ?? true,
    }),
    aiEstimate: clamp(candidate.aiScore ?? 60, 0, 100),
    hookPresence: scoreHookPresence(candidate.hook),
    conclusionPresence: scoreConclusionPresence(candidate.text || ''),
  };

  const finalScore = Object.keys(WEIGHTS).reduce((sum, key) => sum + breakdown[key] * WEIGHTS[key], 0);

  return { finalScore: Math.round(finalScore * 100) / 100, breakdown };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = { scoreClipCandidate, WEIGHTS };
