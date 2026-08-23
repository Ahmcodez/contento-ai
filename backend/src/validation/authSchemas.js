const { z } = require('zod');

const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Must be a valid email address').max(255),
    password: z.string().min(1, 'Password is required'),
    name: z.string().min(1).max(200).optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Must be a valid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

module.exports = { registerSchema, loginSchema };
