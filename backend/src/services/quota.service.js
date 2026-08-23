const AppError = require('../utils/AppError');
const config = require('../config');
const processingJobRepository = require('../repositories/processingJob.repository');

/**
 * V1 quota check: concurrent active job limit. Plan-level upload size /
 * duration / clip-count limits are enforced at their respective
 * validation points (upload size at multer + validate stage, duration at
 * ffprobe validation, clip count at clip-detection post-processing).
 */
async function assertCanStartNewJob(userId) {
  const activeCount = await processingJobRepository.countActiveForUser(userId);
  if (activeCount >= config.limits.maxProcessingJobsPerUserConcurrent) {
    throw AppError.tooManyRequests(
      `You have reached your limit of ${config.limits.maxProcessingJobsPerUserConcurrent} concurrent processing jobs. Wait for one to finish before starting another.`,
      'QUOTA_EXCEEDED',
    );
  }
}

module.exports = { assertCanStartNewJob };
