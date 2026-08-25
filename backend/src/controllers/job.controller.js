const jobService = require('../services/job.service');
const asyncHandler = require('../utils/asyncHandler');

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

module.exports = { getOne, getEvents, cancel };
