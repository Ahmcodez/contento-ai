const { callText } = require('../ai/reliableCall');
const generatedContentRepository = require('../repositories/generatedContent.repository');

const CONTENT_TYPES = ['blog', 'linkedin', 'x_twitter', 'instagram_caption', 'youtube_description'];

const INSTRUCTIONS = {
  blog: 'Write a blog article (600-900 words) based on this video content. Use only facts, quotes, and ideas present in the transcript below — do not invent statistics, names, or claims not present in the source material.',
  linkedin: 'Write a LinkedIn post (150-250 words) based on this video content, grounded strictly in the transcript below.',
  x_twitter: 'Write a single X/Twitter post (under 280 characters) based on this video content, grounded strictly in the transcript below.',
  instagram_caption: 'Write an Instagram caption (under 200 words, with relevant hashtags) based on this video content, grounded strictly in the transcript below.',
  youtube_description: 'Write a YouTube video description (150-300 words) based on this video content, grounded strictly in the transcript below.',
};

const CHAR_LIMITS = { x_twitter: 280 };

function buildPrompt(contentType, transcript, analysis) {
  const instruction = INSTRUCTIONS[contentType];
  return `${instruction}\n\nGROUNDING RULES: Only use information present in the transcript and summary below. Do not add facts, statistics, quotes, or claims that are not present in the source. If you are unsure of a detail, omit it rather than guessing.\n\nSummary: ${analysis.summary}\nKey topics: ${(analysis.topics || []).join(', ')}\n\nFull transcript:\n${transcript.fullText}`;
}

/**
 * Generates one content type from the canonical transcript + analysis —
 * never from the AI's general knowledge alone (docs/PIPELINE.md §3.9,
 * task requirement "do not independently hallucinate facts"). The
 * grounding instruction is enforced at the prompt level; character-limit
 * platforms get a deterministic post-check rather than trusting the
 * model to count characters correctly.
 */
async function generateContent({ provider, contentType, transcript, analysis, userId, processingJobId }) {
  if (!CONTENT_TYPES.includes(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const { text } = await callText({
    provider,
    prompt: buildPrompt(contentType, transcript, analysis),
    maxTokens: 1500,
    userId,
    processingJobId,
  });

  const limit = CHAR_LIMITS[contentType];
  const body = limit && text.length > limit ? text.slice(0, limit - 1).trim() : text.trim();
  const truncated = limit && text.length > limit;

  return { body, metadata: { characterCount: body.length, truncated } };
}

async function persistContent({ processingJobId, contentType, body, metadata, aiProvider }) {
  return generatedContentRepository.upsert({ processingJobId, contentType, body, metadata, aiProvider });
}

module.exports = { generateContent, persistContent, CONTENT_TYPES };
