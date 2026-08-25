const { clipCandidatesSchema, CLIP_CANDIDATES_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { processClipCandidates } = require('../clips/candidates');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

function buildPrompt(transcript, analysis) {
  const topicsLine = (analysis.topics || []).join(', ');
  return `Given this video transcript and its analysis, identify 3-10 potential short-form clip moments. Each clip should: contain a complete idea, have a strong opening line, work without needing outside context, have a useful conclusion, and avoid starting or ending mid-sentence. Ideal duration is 15-90 seconds.\n\nKey topics: ${topicsLine}\nSummary: ${analysis.summary}\n\nFull transcript:\n${transcript.fullText}`;
}

/**
 * Detects clip candidates: asks the AI for proposals, then runs every
 * proposal through deterministic clamping/merging/scoring
 * (src/clips/candidates.js) before anything is trusted or persisted —
 * see docs/AI.md §4.
 */
async function detectClips({ provider, transcript, analysis, userId, processingJobId }) {
  const { data } = await callStructured({
    provider,
    prompt: buildPrompt(transcript, analysis),
    jsonSchema: CLIP_CANDIDATES_JSON_SCHEMA,
    zodSchema: clipCandidatesSchema,
    maxTokens: 2048,
    userId,
    processingJobId,
  });

  const processed = processClipCandidates(data.clips, {
    transcript,
    durationMs: transcript.durationMs || transcript.segments[transcript.segments.length - 1]?.endMs || 0,
  });

  return processed;
}

async function persistClips(processingJobId, candidates) {
  return clipCandidateRepository.createMany(processingJobId, candidates);
}

module.exports = { detectClips, persistClips };
