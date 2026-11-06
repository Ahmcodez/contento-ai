const { z } = require('zod');

const url = z.string().trim().min(1).max(2048);

const infoBody = z.object({ body: z.object({ url }) });
const createBody = z.object({ body: z.object({ url, optionId: z.string().trim().min(1).max(40) }) });
const jobIdParam = z.object({ params: z.object({ id: z.string().regex(/^[a-f0-9]{32}$/, 'Invalid download id') }) });

module.exports = { infoBody, createBody, jobIdParam };
