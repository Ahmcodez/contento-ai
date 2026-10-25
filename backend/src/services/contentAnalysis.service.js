const config = require('../config');
const { buildTimedLines, chunkTimedLines, resolveLineSpan } = require('../transcript/timed');
const { contentAnalysisSchema, CONTENT_ANALYSIS_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('../ai/promptSafety');
const contentAnalysisRepository = require('../repositories/contentAnalysis.repository');

const CATEGORY_FIELDS = [
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
const ARRAY_FIELDS = ['topics', ...CATEGORY_FIELDS];

// Ask for more proposals than clips wanted, so the selection step has real choice
// (overlaps and weak candidates get dropped) without a second pass over the transcript.
const PROPOSAL_OVERSHOOT = 1.6;
const MAX_PROPOSALS_PER_CHUNK = 24;
// Per-category cap in the prompt: keeps the output short (output tokens cost more than
// input) and keeps the later prompts that quote these lists small.
const MAX_ITEMS_PER_CATEGORY = 5;

/**
 * How many clip proposals to request from one chunk: this chunk's share of the whole
 * video times (clips wanted x overshoot), at least one so every stretch of the video
 * can contribute a candidate and the final picks can be spread across it.
 */
function proposalQuota({ requestedClipCount, chunkDurationMs, totalDurationMs }) {
  const share = totalDurationMs > 0 ? chunkDurationMs / totalDurationMs : 1;
  const wanted = Math.ceil(requestedClipCount * PROPOSAL_OVERSHOOT * share);
  return Math.max(1, Math.min(MAX_PROPOSALS_PER_CHUNK, wanted));
}

function buildPrompt(chunkText, { quota }) {
  const { clipMinDurationSeconds: minSec, clipMaxDurationSeconds: maxSec } = config.limits;
  return `Analyze this portion of a video transcript in depth.

Each line starts with its id in square brackets, like [412]. Lines like "-- 3:05 --" are time markers, not speech. Refer to places in the transcript ONLY by these ids (startLine / endLine), never by time.

Identify, most significant first and at most ${MAX_ITEMS_PER_CATEGORY} per category: key topics (short strings), key points, stories told, strong opinions, educational moments, surprising statements, questions raised, conclusions reached, memorable quotes, and self-contained ideas. Give each item the startLine and endLine where it is said. Also write a one-paragraph summary of just this portion.

Then propose up to ${quota} short-form clip${quota === 1 ? '' : 's'} (for TikTok, Reels and Shorts, where a viewer decides within 1-3 seconds whether to keep watching). Each clip is ONE topic and must:
- START at the line where the HOOK is first spoken: a line that grabs attention by itself, such as a surprising or counterintuitive claim, a question the viewer wants answered, a concrete number up front, a consequence stated before its explanation, or direct address to the viewer's situation. Do not start on lead-up, throat-clearing, or a transition ("so anyway", "today I want to talk about"). If the hook line comes a few lines after the topic begins, startLine is the hook line, not the lead-up.
- RUN THROUGH the line where that topic's explanation is complete, ending on a real conclusion, so it makes sense without outside context. endLine is that last line.
- Last roughly ${minSec}-${maxSec} seconds of speech (use the time markers to judge).
- Not overlap another proposed clip; each covers a different topic.
"hook" is the opening words exactly as spoken at startLine, verbatim, not a paraphrase or a title. "score" is 0-100 for how likely the clip is to hold viewers.

Transcript portion:
${delimitTranscript(chunkText)}`;
}

/** Maps an item's line ids to real timestamps, and drops the ids (only times are stored). */
function resolveItemTimes(item, lines) {
  const { startLine, endLine, ...rest } = item;
  const span = resolveLineSpan(lines, startLine, endLine);
  if (!span) return rest;
  return { ...rest, startMs: span.lines[0].startMs, endMs: span.lines[span.lines.length - 1].endMs };
}

/** Keeps only proposals whose line ids point at real lines, clamped and ordered. */
function resolveProposals(rawClips, lines) {
  const resolved = [];
  for (const clip of rawClips || []) {
    const span = resolveLineSpan(lines, clip.startLine, clip.endLine);
    if (!span) continue;
    resolved.push({
      startLine: span.startLine,
      endLine: span.endLine,
      hook: clip.hook,
      title: clip.title,
      summary: clip.summary,
      reason: clip.reason,
      topic: clip.topic,
      score: clip.score,
    });
  }
  return resolved;
}

/**
 * Runs content analysis over the whole transcript in line-numbered chunks and, in
 * the same pass, collects clip proposals. One pass over the transcript, not two:
 * clip detection used to re-send the entire transcript to the model.
 * Chunks run sequentially, not in parallel, to bound concurrent AI spend
 * (docs/COST.md §4); each is validated on its own, so one malformed chunk retries
 * by itself rather than invalidating the whole analysis.
 */
async function analyzeTranscript({ provider, transcript, userId, processingJobId, requestedClipCount = config.limits.defaultClipsPerVideo }) {
  const lines = buildTimedLines(transcript.segments);
  const chunks = chunkTimedLines(lines, {
    maxCharsPerChunk: config.limits.maxTranscriptCharsPerAiCall,
    maxChunks: config.limits.maxTranscriptChunks,
  });

  if (chunks.length === 0) {
    throw new Error('Transcript has no content to analyze');
  }

  const totalDurationMs = lines[lines.length - 1].endMs - lines[0].startMs;
  const chunkResults = [];
  for (const chunk of chunks) {
    const quota = proposalQuota({
      requestedClipCount,
      chunkDurationMs: chunk.endMs - chunk.startMs,
      totalDurationMs,
    });
    const { data } = await callStructured({
      provider,
      prompt: buildPrompt(chunk.text, { quota }),
      systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
      jsonSchema: CONTENT_ANALYSIS_JSON_SCHEMA,
      zodSchema: contentAnalysisSchema,
      maxTokens: 6144,
      userId,
      processingJobId,
    });

    const result = { ...data };
    for (const field of CATEGORY_FIELDS) {
      result[field] = (data[field] || []).map((item) => resolveItemTimes(item, lines));
    }
    result.clips = resolveProposals(data.clips, lines);
    chunkResults.push(result);
  }

  return mergeAnalyses(chunkResults);
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
  merged.clips = chunkResults.flatMap((r) => r.clips || []);

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

module.exports = { analyzeTranscript, persistAnalysis, mergeAnalyses, buildPrompt, proposalQuota };
