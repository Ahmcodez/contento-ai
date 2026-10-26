const config = require('../config');
const { clipProposalsSchema, CLIP_PROPOSALS_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('../ai/promptSafety');
const { clipProposalInstructions } = require('../clips/prompt');
const { buildCandidates, selectClips } = require('../clips/select');
const { buildTimedLines, chunkTimedLines, resolveLineSpan } = require('../transcript/timed');
const { proposalQuota } = require('./contentAnalysis.service');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

function buildFallbackPrompt(chunkText, { quota }) {
  return `Find the best short-form clips in this portion of a video transcript.

Each line starts with its id in square brackets, like [412]. Lines like "-- 3:05 --" are time markers, not speech. Refer to places in the transcript ONLY by these ids (startLine / endLine), never by time.

${clipProposalInstructions(quota)}

Transcript portion:
${delimitTranscript(chunkText)}`;
}

/**
 * Last resort: ask the model for clip proposals directly. Used only when the analysis
 * pass left none (an analysis stored before proposals existed, or a model that returned
 * an empty list). Costs one more pass over the transcript, which is exactly what the
 * normal path avoids, so it is deliberately not the default.
 */
async function proposeClips({ provider, lines, requestedClipCount, userId, processingJobId }) {
  const chunks = chunkTimedLines(lines, {
    maxCharsPerChunk: config.limits.maxTranscriptCharsPerAiCall,
    maxChunks: config.limits.maxTranscriptChunks,
  });
  const totalDurationMs = lines[lines.length - 1].endMs - lines[0].startMs;

  const proposals = [];
  for (const chunk of chunks) {
    const quota = proposalQuota({ requestedClipCount, chunkDurationMs: chunk.endMs - chunk.startMs, totalDurationMs });
    const { data } = await callStructured({
      provider,
      prompt: buildFallbackPrompt(chunk.text, { quota }),
      systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
      jsonSchema: CLIP_PROPOSALS_JSON_SCHEMA,
      zodSchema: clipProposalsSchema,
      maxTokens: 3072,
      userId,
      processingJobId,
    });
    for (const clip of data.clips) {
      const span = resolveLineSpan(lines, clip.startLine, clip.endLine);
      if (span) proposals.push({ ...clip, startLine: span.startLine, endLine: span.endLine });
    }
  }
  return proposals;
}

/**
 * Chooses the clips for a job. Normally this makes no AI call at all: the analysis pass
 * already proposed clips (as hook line .. end of explanation), and this turns them into
 * exact, length-bounded, scored clips and picks the requested number, spread across the
 * video. Returns { candidates, source, proposalCount }.
 */
async function detectClips({ provider, transcript, analysis, requestedClipCount, userId, processingJobId }) {
  const count = requestedClipCount || config.limits.defaultClipsPerVideo;
  const lines = buildTimedLines(transcript.segments);
  if (lines.length === 0) return { candidates: [], source: 'none', proposalCount: 0 };

  const durationMs = transcript.durationMs || lines[lines.length - 1].endMs;
  const select = (proposals) => selectClips(buildCandidates(proposals, lines, { durationMs }), { count, durationMs });

  const stored = analysis?.clips || [];
  let candidates = select(stored);
  if (candidates.length > 0) return { candidates, source: 'analysis', proposalCount: stored.length };

  const proposed = await proposeClips({ provider, lines, requestedClipCount: count, userId, processingJobId });
  candidates = select(proposed);
  return { candidates, source: 'fallback', proposalCount: proposed.length };
}

async function persistClips(processingJobId, candidates) {
  return clipCandidateRepository.createMany(processingJobId, candidates);
}

module.exports = { detectClips, persistClips, buildFallbackPrompt };
