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
 * Clip proposals on their own, for the fallback detector (the normal path gets its
 * proposals from the analysis pass). Same proposal shape, same required hook: a response
 * without a real hook fails validation and retries (reliableCall's schema-retry path)
 * instead of silently shipping a clip with no hook. Shape only: times, lengths and
 * overlap are enforced in code afterwards (src/clips/select.js).
 */
const clipProposalsSchema = z.object({ clips: z.array(clipProposalSchema).default([]) });

const CLIP_PROPOSALS_JSON_SCHEMA = {
  type: 'object',
  properties: { clips: CONTENT_ANALYSIS_JSON_SCHEMA.properties.clips },
  required: ['clips'],
};

/**
 * All five written pieces from one call (see contentGeneration.service.generateAllContent).
 * Minimum lengths only catch an empty or truncated answer; the real length limits are
 * enforced in code afterwards.
 */
const contentBundleSchema = z.object({
  blog: z.string().min(100),
  linkedin: z.string().min(30),
  x_twitter: z.string().min(5),
  instagram_caption: z.string().min(10),
  youtube_description: z.string().min(30),
});

const CONTENT_BUNDLE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    blog: { type: 'string' },
    linkedin: { type: 'string' },
    x_twitter: { type: 'string' },
    instagram_caption: { type: 'string' },
    youtube_description: { type: 'string' },
  },
  required: ['blog', 'linkedin', 'x_twitter', 'instagram_caption', 'youtube_description'],
};

module.exports = {
  contentAnalysisSchema,
  CONTENT_ANALYSIS_JSON_SCHEMA,
  clipProposalSchema,
  clipProposalsSchema,
  CLIP_PROPOSALS_JSON_SCHEMA,
  contentBundleSchema,
  CONTENT_BUNDLE_JSON_SCHEMA,
};
