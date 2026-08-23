const { z } = require('zod');

const idParam = z.object({ params: z.object({ id: z.string().uuid('Invalid id') }) });

const createProjectSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').max(300),
    description: z.string().max(2000).optional(),
  }),
});

const listProjectsSchema = z.object({
  query: z.object({
    status: z.enum(['active', 'archived']).optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
  }),
});

const updateProjectSchema = idParam.extend({
  body: z.object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(['active', 'archived']).optional(),
  }),
});

module.exports = { idParam, createProjectSchema, listProjectsSchema, updateProjectSchema };
