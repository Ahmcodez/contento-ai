const path = require('path');
const db = require('../db/client');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('./queues');

/**
 * Shared by everything that has to put a pipeline job back on the queue after
 * the normal producer chain was interrupted: the stuck-job reaper
 * (src/workers/stuckJobReaper.js) and the user-facing retry
 * (src/services/job.service.js). Kept in one place so the two can't drift on
 * which stage owns which state, or what payload a stage expects.
 */

/** Non-terminal processing_jobs states -> the stage whose queue job should exist. */
const PIPELINE_STATE_TO_STAGE = {
  UPLOADED: QUEUE_NAMES.VIDEO_VALIDATE,
  VALIDATING: QUEUE_NAMES.VIDEO_VALIDATE,
  VALIDATED: QUEUE_NAMES.AUDIO_EXTRACT,
  EXTRACTING_AUDIO: QUEUE_NAMES.AUDIO_EXTRACT,
  AUDIO_EXTRACTED: QUEUE_NAMES.TRANSCRIPTION_PROCESS,
  TRANSCRIBING: QUEUE_NAMES.TRANSCRIPTION_PROCESS,
  TRANSCRIBED: QUEUE_NAMES.CONTENT_ANALYZE,
  ANALYZING: QUEUE_NAMES.CONTENT_ANALYZE,
  ANALYZED: QUEUE_NAMES.CLIPS_DETECT,
  FINDING_CLIPS: QUEUE_NAMES.CLIPS_DETECT,
  CLIPS_FOUND: QUEUE_NAMES.CLIPS_DETECT,
  SCORING_CLIPS: QUEUE_NAMES.CLIPS_DETECT,
  CLIPS_SCORED: QUEUE_NAMES.CLIP_RENDER,
  RENDERING_CLIPS: QUEUE_NAMES.CLIP_RENDER,
  CLIPS_RENDERED: QUEUE_NAMES.CONTENT_GENERATE,
  GENERATING_CONTENT: QUEUE_NAMES.CONTENT_GENERATE,
  CONTENT_GENERATED: QUEUE_NAMES.JOB_FINALIZE,
  FINALIZING: QUEUE_NAMES.JOB_FINALIZE,
};

const STAGE_JOB_NAMES = {
  [QUEUE_NAMES.URL_IMPORT_RESOLVE]: 'url-import.resolve',
  [QUEUE_NAMES.URL_IMPORT_DOWNLOAD]: 'url-import.download',
  [QUEUE_NAMES.VIDEO_VALIDATE]: 'video.validate',
  [QUEUE_NAMES.AUDIO_EXTRACT]: 'audio.extract',
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: 'transcription.process',
  [QUEUE_NAMES.CONTENT_ANALYZE]: 'content.analyze',
  [QUEUE_NAMES.CLIPS_DETECT]: 'clips.detect',
  [QUEUE_NAMES.CLIP_RENDER]: 'clip.render',
  [QUEUE_NAMES.CONTENT_GENERATE]: 'content.generate',
  [QUEUE_NAMES.JOB_FINALIZE]: 'job.finalize',
};

/** Same derivation as audioExtract.processor.js, so a re-enqueued job points at the same file. */
function audioKeyFor(storageKey) {
  return storageKey.replace(path.extname(storageKey), '.audio.wav');
}

/**
 * Rebuilds the exact payload the stage's own producer would have enqueued,
 * from what is in the database. Returns null if it can't (asset gone).
 */
async function buildPipelinePayload(stage, row) {
  const asset = await db('media_assets').where({ id: row.media_asset_id }).first();
  if (!asset) return null;

  const base = { processingJobId: row.id, mediaAssetId: asset.id };
  if (stage === QUEUE_NAMES.TRANSCRIPTION_PROCESS) {
    return { ...base, audioStorageKey: audioKeyFor(asset.storage_key) };
  }
  if (stage === QUEUE_NAMES.CLIP_RENDER) {
    const candidates = await db('clip_candidates').where({ processing_job_id: row.id }).orderBy('rank', 'asc').select('id');
    return { ...base, clipCandidateIds: candidates.map((c) => c.id) };
  }
  return base;
}

/** Adds a stage's job with its normal per-stage retry policy. */
async function enqueueStage(stage, payload) {
  return getQueue(stage).add(STAGE_JOB_NAMES[stage], payload, {
    ...RETRY_CONFIG[stage],
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

module.exports = { PIPELINE_STATE_TO_STAGE, STAGE_JOB_NAMES, audioKeyFor, buildPipelinePayload, enqueueStage };
