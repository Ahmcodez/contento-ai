const AppError = require('../utils/AppError');
const jobService = require('./job.service');
const db = require('../db/client');
const generatedContentRepository = require('../repositories/generatedContent.repository');
const contentAnalysisRepository = require('../repositories/contentAnalysis.repository');
const transcriptService = require('./transcript.service');
const contentGenerationService = require('./contentGeneration.service');
const { getAIProvider } = require('../ai');
const { AIProviderError } = require('../ai/AIProvider');

function rowToContent(row) {
  return {
    id: row.id,
    contentType: row.content_type,
    body: row.body,
    metadata: row.metadata,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

async function listContentForJob(userId, jobId) {
  const job = await jobService.assertJobAccess(userId, jobId);
  const rows = await generatedContentRepository.listByProcessingJobId(job.id);
  return rows.map(rowToContent);
}

async function updateContent(userId, contentId, body) {
  // Ownership check goes through the parent job, same pattern as clips.
  const row = await db('generated_content').where({ id: contentId }).first();
  if (!row) throw AppError.notFound('Content not found');
  await jobService.assertJobAccess(userId, row.processing_job_id);

  const [updated] = await db('generated_content')
    .where({ id: contentId })
    .update({ body, status: 'edited', updated_at: db.fn.now() })
    .returning('*');
  return rowToContent(updated);
}

/**
 * Regenerates a single content type on demand — reuses the same grounded
 * generation service the pipeline uses, so the "regenerate" button in
 * the UI produces output through the identical, tested code path.
 */
async function regenerateContent(userId, jobId, contentType) {
  const job = await jobService.assertJobAccess(userId, jobId);
  const mediaAsset = await db('media_assets').where({ id: job.media_asset_id }).first();

  const transcript = await transcriptService.getNormalizedTranscript(mediaAsset.id);
  if (!transcript) {
    throw AppError.conflict('Transcript is not available yet for this job', 'NOT_READY');
  }
  const analysisRow = await contentAnalysisRepository.findByProcessingJobId(job.id);
  if (!analysisRow) {
    throw AppError.conflict('Content analysis is not available yet for this job', 'NOT_READY');
  }

  const provider = getAIProvider();
  try {
    const { body, metadata } = await contentGenerationService.generateContent({
      provider,
      contentType,
      transcript,
      analysis: { summary: analysisRow.summary, topics: analysisRow.topics },
      userId,
      processingJobId: job.id,
    });
    const updated = await contentGenerationService.persistContent({
      processingJobId: job.id,
      contentType,
      body,
      metadata,
      aiProvider: provider.constructor.name,
    });
    return rowToContent(updated);
  } catch (err) {
    if (err instanceof AIProviderError) {
      throw AppError.badRequest(err.message, err.reason === 'not_configured' ? 'AI_NOT_CONFIGURED' : 'AI_ERROR');
    }
    throw err;
  }
}

module.exports = { listContentForJob, updateContent, regenerateContent };
