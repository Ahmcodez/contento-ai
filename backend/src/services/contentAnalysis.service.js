const config = require('../config');
const { chunkTranscript } = require('../transcript/chunk');
const { contentAnalysisSchema, CONTENT_ANALYSIS_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('../ai/promptSafety');
const contentAnalysisRepository = require('../repositories/contentAnalysis.repository');

const ARRAY_FIELDS = [
  'topics',
  'keyPoints',
  'stories',
  'strongOpinions',
  'educationalMoments',
  'surprisingStatements',
  'questions',
  'conclusions',
  'memorableQuotes',
  'selfContainedIdeas',
];

function buildPrompt(chunkText) {
  return `Analyze the following portion of a video transcript in depth. Identify: key topics, key points, stories told, strong opinions expressed, educational moments, surprising statements, questions raised, conclusions reached, memorable quotes, and self-contained ideas that could stand alone as a short clip. Include approximate startMs/endMs timestamps where the transcript text suggests them (timestamps in this portion are relative to the full video, not this excerpt). Also provide a one-paragraph summary of just this portion.\n\nTranscript portion:\n${delimitTranscript(chunkText)}`;
}

/**
 * Runs content analysis across the full transcript, chunking when needed
 * (docs/COST.md, docs/AI.md §3) rather than sending an unbounded prompt.
 * Each chunk is validated independently (reliableCall) before merging —
 * one malformed chunk retries on its own rather than invalidating the
 * whole analysis.
 */
async function analyzeTranscript({ provider, transcript, userId, processingJobId }) {
  const chunks = chunkTranscript(transcript.segments, {
    maxCharsPerChunk: config.limits.maxTranscriptCharsPerAiCall,
    maxChunks: config.limits.maxTranscriptChunks,
  });

  if (chunks.length === 0) {
    throw new Error('Transcript has no content to analyze');
  }

  const chunkResults = [];
  for (const chunk of chunks) {
    // Sequential, not parallel — bounds concurrent AI spend per job
    // (docs/COST.md §4) rather than firing every chunk at once.
    // eslint-disable-next-line no-await-in-loop
    const { data } = await callStructured({
      provider,
      prompt: buildPrompt(chunk.text),
      systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
      jsonSchema: CONTENT_ANALYSIS_JSON_SCHEMA,
      zodSchema: contentAnalysisSchema,
      maxTokens: 4096,
      userId,
      processingJobId,
    });
    chunkResults.push(data);
  }

  const merged = mergeAnalyses(chunkResults);
  return merged;
}

function mergeAnalyses(chunkResults) {
  const merged = { summary: chunkResults.map((r) => r.summary).join(' ') };

  for (const field of ARRAY_FIELDS) {
    if (field === 'topics') {
      merged.topics = dedupeStrings(chunkResults.flatMap((r) => r.topics || []));
    } else {
      merged[field] = chunkResults.flatMap((r) => r[field] || []);
    }
  }

  return merged;
}

function dedupeStrings(items) {
  return [...new Set(items.map((s) => s.trim().toLowerCase()))].map(
    (lower) => items.find((s) => s.trim().toLowerCase() === lower),
  );
}

async function persistAnalysis({ processingJobId, analysis, aiProvider }) {
  return contentAnalysisRepository.create({ processingJobId, analysis, aiProvider });
}

module.exports = { analyzeTranscript, persistAnalysis, mergeAnalyses };
