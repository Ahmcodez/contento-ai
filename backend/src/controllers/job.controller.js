const jobService = require('../services/job.service');
const transcriptViewService = require('../services/transcriptView.service');
const clipViewService = require('../services/clipView.service');
const contentViewService = require('../services/contentView.service');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const getOne = asyncHandler(async (req, res) => {
  const job = await jobService.getJob(req.user.id, req.params.jobId);
  res.status(200).json(job);
});

const getEvents = asyncHandler(async (req, res) => {
  const events = await jobService.getJobEvents(req.user.id, req.params.jobId);
  res.status(200).json({ data: events });
});

const cancel = asyncHandler(async (req, res) => {
  const job = await jobService.cancelJob(req.user.id, req.params.jobId);
  res.status(200).json(job);
});

const getTranscript = asyncHandler(async (req, res) => {
  const transcript = await transcriptViewService.getTranscriptForJob(req.user.id, req.params.jobId);
  if (!transcript) {
    throw AppError.conflict('Transcript is not ready yet for this job', 'NOT_READY');
  }
  res.status(200).json(transcript);
});

const getClips = asyncHandler(async (req, res) => {
  const clips = await clipViewService.listClipsForJob(req.user.id, req.params.jobId);
  res.status(200).json({ data: clips });
});

const getContent = asyncHandler(async (req, res) => {
  const content = await contentViewService.listContentForJob(req.user.id, req.params.jobId);
  res.status(200).json({ data: content });
});

const regenerateContent = asyncHandler(async (req, res) => {
  const content = await contentViewService.regenerateContent(req.user.id, req.params.jobId, req.params.contentType);
  res.status(200).json({ content });
});

module.exports = { getOne, getEvents, cancel, getTranscript, getClips, getContent, regenerateContent };
