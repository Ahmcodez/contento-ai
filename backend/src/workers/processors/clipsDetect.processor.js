const logger = require('../../logger');
const processingJobRepository = require('../../repositories/processingJob.repository');
const { getAIProvider } = require('../../ai');
const { AIProviderError } = require('../../ai/AIProvider');

const CLIP_CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startMs: { type: 'number' },
          endMs: { type: 'number' },
          title: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['startMs', 'endMs', 'title'],
      },
    },
  },
  required: ['clips'],
};

/**
 * Detects clip candidates via the AI provider. Persistence into
 * clip_candidates (and the deterministic clamping/merging/limit-
 * enforcement pass described in docs/AI.md §4) lands in the milestone
 * that builds the clip review UI (docs/SUMMARY.md milestone 7) — this
 * processor proves the queue -> AI provider -> state-transition hop for
 * this stage without a schema that doesn't exist yet in this milestone.
 */
async function processClipsDetect(job) {
  const { processingJobId, mediaAssetId, fullText, analysis } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'ANALYZED',
    toState: 'FINDING_CLIPS',
  });

  const provider = getAIProvider();
  const prompt = `Given this transcript and analysis, identify the 3-10 most compelling short-form clip moments (15-90 seconds each). Analysis summary: ${analysis?.summary || ''}\n\nTranscript:\n${fullText}`;

  let result;
  try {
    result = await provider.generateStructuredOutput({ prompt, schema: CLIP_CANDIDATE_SCHEMA, maxTokens: 2048 });
  } catch (err) {
    if (err instanceof AIProviderError && !err.retryable) {
      await processingJobRepository.transitionState(processingJobId, {
        fromState: 'FINDING_CLIPS',
        toState: 'FAILED',
        failureStage: 'FINDING_CLIPS',
        errorMessage: err.message,
      });
      logger.warn({ processingJobId, mediaAssetId, reason: err.reason }, 'AI provider not configured, job failed cleanly');
      return;
    }
    throw err;
  }

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'FINDING_CLIPS',
    toState: 'CLIPS_FOUND',
    progressPercent: 65,
    metadata: { candidateCount: result.data.clips?.length || 0 },
  });

  logger.info({ processingJobId, mediaAssetId }, 'clips.detect completed (downstream stages pending milestone 7)');
}

module.exports = processClipsDetect;
