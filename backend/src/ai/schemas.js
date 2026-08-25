const { z } = require('zod');

const timestampedItem = z.object({
  text: z.string().min(1),
  startMs: z.number().nonnegative().optional(),
  endMs: z.number().nonnegative().optional(),
});

/**
 * Validates the shape of Gemini's content-analysis output (docs/AI.md §5
 * — every generateStructuredOutput call validates against a schema before
 * the result is trusted by business logic).
 */
const contentAnalysisSchema = z.object({
  summary: z.string().min(1),
  topics: z.array(z.string()).default([]),
  keyPoints: z.array(timestampedItem).default([]),
  stories: z.array(timestampedItem).default([]),
  strongOpinions: z.array(timestampedItem).default([]),
  educationalMoments: z.array(timestampedItem).default([]),
  surprisingStatements: z.array(timestampedItem).default([]),
  questions: z.array(timestampedItem).default([]),
  conclusions: z.array(timestampedItem).default([]),
  memorableQuotes: z.array(timestampedItem).default([]),
  selfContainedIdeas: z.array(timestampedItem).default([]),
});

const CONTENT_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    keyPoints: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    stories: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    strongOpinions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    educationalMoments: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    surprisingStatements: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    questions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    conclusions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    memorableQuotes: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
    selfContainedIdeas: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, startMs: { type: 'number' }, endMs: { type: 'number' } } } },
  },
  required: ['summary', 'topics'],
};

/**
 * Validates AI-proposed clip candidates. Note this only validates *shape*
 * — the deterministic clamping/bounds-checking against the real
 * transcript duration happens separately in src/clips/candidates.js
 * (docs/AI.md §4 "AI proposes, code disposes").
 */
const clipCandidatesSchema = z.object({
  clips: z
    .array(
      z.object({
        startMs: z.number().nonnegative(),
        endMs: z.number().positive(),
        title: z.string().min(1).max(200),
        hook: z.string().max(500).optional(),
        summary: z.string().max(1000).optional(),
        reason: z.string().max(500).optional(),
        topic: z.string().max(200).optional(),
        estimatedQualityScore: z.number().min(0).max(100).optional(),
      }),
    )
    .default([]),
});

const CLIP_CANDIDATES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startMs: { type: 'number' },
          endMs: { type: 'number' },
          title: { type: 'string' },
          hook: { type: 'string' },
          summary: { type: 'string' },
          reason: { type: 'string' },
          topic: { type: 'string' },
          estimatedQualityScore: { type: 'number' },
        },
        required: ['startMs', 'endMs', 'title'],
      },
    },
  },
  required: ['clips'],
};

module.exports = {
  contentAnalysisSchema,
  CONTENT_ANALYSIS_JSON_SCHEMA,
  clipCandidatesSchema,
  CLIP_CANDIDATES_JSON_SCHEMA,
};
