const jobService = require('./job.service');
const transcriptRepository = require('../repositories/transcript.repository');
const db = require('../db/client');

/**
 * Fetches the transcript for a processing job, scoped through the same
 * ownership check as every other job sub-resource. Returns null (not an
 * error) if the job hasn't reached TRANSCRIBED yet — that's a normal,
 * expected state for the frontend to handle, not a failure.
 */
async function getTranscriptForJob(userId, jobId) {
  const job = await jobService.assertJobAccess(userId, jobId);
  const mediaAsset = await db('media_assets').where({ id: job.media_asset_id }).first();

  const transcript = await transcriptRepository.findByMediaAssetId(mediaAsset.id);
  if (!transcript) return null;

  const segments = await transcriptRepository.findSegments(transcript.id);
  return {
    fullText: transcript.full_text,
    language: transcript.language,
    segments: segments.map((s) => ({
      startMs: s.start_ms,
      endMs: s.end_ms,
      text: s.text,
      speakerLabel: s.speaker_label,
    })),
  };
}

module.exports = { getTranscriptForJob };
