const express = require('express');
const controller = require('../controllers/project.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  idParam,
  createProjectSchema,
  listProjectsSchema,
  updateProjectSchema,
} = require('../validation/projectSchemas');

const router = express.Router();

router.use(requireAuth);

router.post('/', validate(createProjectSchema), controller.create);
router.get('/', validate(listProjectsSchema), controller.list);
router.get('/:id', validate(idParam), controller.getOne);
router.patch('/:id', validate(updateProjectSchema), controller.update);
router.delete('/:id', validate(idParam), controller.remove);

module.exports = router;
