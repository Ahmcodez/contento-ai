const projectService = require('../services/project.service');
const asyncHandler = require('../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const project = await projectService.createProject(req.user.id, req.body);
  res.status(201).json({ project });
});

const list = asyncHandler(async (req, res) => {
  const { rows, total, page, pageSize } = await projectService.listProjects(req.user.id, req.query);
  res.status(200).json({ data: rows, pagination: { page, pageSize, total } });
});

const getOne = asyncHandler(async (req, res) => {
  const project = await projectService.getProject(req.user.id, req.params.id);
  res.status(200).json({ project });
});

const update = asyncHandler(async (req, res) => {
  const project = await projectService.updateProject(req.user.id, req.params.id, req.body);
  res.status(200).json({ project });
});

const remove = asyncHandler(async (req, res) => {
  await projectService.archiveProject(req.user.id, req.params.id);
  res.status(204).send();
});

module.exports = { create, list, getOne, update, remove };
