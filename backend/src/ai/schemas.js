const { z } = require('zod');

// Places in the transcript are referred to by line id (see src/transcript/timed.js),
// never by time: the model is shown ids, not timestamps, and code maps ids to the real
// times afterwards. startMs/endMs stay optional only so older stored analyses still parse.
const timestampedItem = z.object({
  text: z.string().min(1),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  startMs: z.number().nonnegative().optional(),
  endMs: z.number().nonnegative().optional(),
});

/**
 * One proposed short-form clip, as line ids: startLine is where the HOOK is first
 * spoken, endLine is where that topic's explanation finishes. The hook text is
 * required (see the note on clipCandidatesSchema.hook for why).
 */
const clipProposalSchema = z.object({
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative().optional(),
  hook: z.string().min(5).max(500),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).optional(),
  reason: z.string().max(500).optional(),
  topic: z.string().max(200).optional(),
  score: z.number().min(0).max(100).optional(),
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
  clips: z.array(clipProposalSchema).default([]),
});

const ITEM_JSON = {
  type: 'array',
  items: { type: 'object', properties: { text: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['text'] },
};

const CONTENT_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
    keyPoints: ITEM_JSON,
    stories: ITEM_JSON,
    strongOpinions: ITEM_JSON,
    educationalMoments: ITEM_JSON,
    surprisingStatements: ITEM_JSON,
    questions: ITEM_JSON,
    conclusions: ITEM_JSON,
    memorableQuotes: ITEM_JSON,
    selfContainedIdeas: ITEM_JSON,
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          hook: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          reason: { type: 'string' },
          topic: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['startLine', 'endLine', 'hook', 'title'],
      },
    },
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
        // Required, not optional: the literal opening line a viewer hears in
        // the first 1-3 seconds. Making this mandatory means a response
        // without a real hook fails schema validation and retries (see
        // reliableCall.js's JSON/schema-validation retry path) instead of
        // silently shipping a clip with no hook — the schema enforces the
        // product requirement, not just the prompt wording.
        hook: z.string().min(10).max(500),
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
          hook: { type: 'string', description: 'The literal opening line, spoken in the first 1-3 seconds, that hooks the viewer.' },
          summary: { type: 'string' },
          reason: { type: 'string' },
          topic: { type: 'string' },
          estimatedQualityScore: { type: 'number' },
        },
        required: ['startMs', 'endMs', 'title', 'hook'],
      },
    },
  },
  required: ['clips'],
};

module.exports = {
  contentAnalysisSchema,
  CONTENT_ANALYSIS_JSON_SCHEMA,
  clipProposalSchema,
  clipCandidatesSchema,
  CLIP_CANDIDATES_JSON_SCHEMA,
};
