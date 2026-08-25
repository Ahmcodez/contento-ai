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

function scoreHookPresence(hook) {
  return hook && hook.trim().length > 0 ? 100 : 40;
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
