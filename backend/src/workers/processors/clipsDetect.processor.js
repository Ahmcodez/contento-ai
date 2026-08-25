const logger = require('../../logger');
const db = require('../../db/client');
const processingJobRepository = require('../../repositories/processingJob.repository');
const contentAnalysisRepository = require('../../repositories/contentAnalysis.repository');
const transcriptService = require('../../services/transcript.service');
const clipDetectionService = require('../../services/clipDetection.service');
const { getAIProvider } = require('../../ai');
const { AIProviderError } = require('../../ai/AIProvider');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

function rowToAnalysis(row) {
  return {
    summary: row.summary,
    topics: row.topics,
    keyPoints: row.key_points,
    stories: row.stories,
    strongOpinions: row.strong_opinions,
    educationalMoments: row.educational_moments,
    surprisingStatements: row.surprising_statements,
    questions: row.questions,
    conclusions: row.conclusions,
    memorableQuotes: row.memorable_quotes,
    selfContainedIdeas: row.self_contained_ideas,
  };
}

/**
 * Detects, scores, and persists clip candidates. CLIPS_FOUND and
 * CLIPS_SCORED (docs/PIPELINE.md §3.6-3.7) are both traversed here rather
 * than as separate queue hops — scoring is deterministic and already
 * computed as part of processClipCandidates (src/clips/candidates.js),
 * so there's no real work for a separate clips.score job to do; the
 * state machine still records both transitions for accurate status/history.
 */
async function processClipsDetect(job) {
  const { processingJobId, mediaAssetId } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'ANALYZED',
    toState: 'FINDING_CLIPS',
  });

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  const userId = mediaAsset.uploaded_by;
  const transcript = await transcriptService.getNormalizedTranscript(mediaAssetId);
  const analysisRow = await contentAnalysisRepository.findByProcessingJobId(processingJobId);
  const analysis = rowToAnalysis(analysisRow);
  const provider = getAIProvider();

  let candidates;
  try {
    candidates = await clipDetectionService.detectClips({ provider, transcript, analysis, userId, processingJobId });
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
    metadata: { candidateCount: candidates.length },
  });

  const persisted = await clipDetectionService.persistClips(processingJobId, candidates);

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'CLIPS_FOUND',
    toState: 'CLIPS_SCORED',
    progressPercent: 65,
  });

  await getQueue(QUEUE_NAMES.CLIP_RENDER).add(
    'clip.render',
    { processingJobId, mediaAssetId, clipCandidateIds: persisted.map((c) => c.id) },
    { ...RETRY_CONFIG[QUEUE_NAMES.CLIP_RENDER], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId, clipCount: persisted.length }, 'clips.detect completed');
}

module.exports = processClipsDetect;
