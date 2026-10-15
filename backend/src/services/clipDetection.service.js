const { clipCandidatesSchema, CLIP_CANDIDATES_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('../ai/promptSafety');
const { processClipCandidates } = require('../clips/candidates');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

function formatTimestampMs(ms) {
  if (ms === undefined || ms === null) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats one analysis category (stories, memorableQuotes, etc.) as a
 * compact, timestamped bullet list for the prompt. Capped per category
 * (default 12) — content-analyze's own schema places no limit on how
 * many items it returns, and a long podcast can plausibly yield dozens;
 * without a cap, this prompt (and its token cost) would grow unbounded
 * with source length instead of staying roughly flat.
 */
function formatSignalList(items, { cap = 12 } = {}) {
  if (!items || items.length === 0) return null;
  return items
    .slice(0, cap)
    .map((item) => {
      const ts = formatTimestampMs(item.startMs);
      return ts ? `- [${ts}] ${item.text}` : `- ${item.text}`;
    })
    .join('\n');
}

/**
 * Real gap this closes: content-analyze already extracts stories,
 * memorable quotes, surprising statements and strong opinions into
 * structured, timestamped fields (contentAnalysis.repository.js) — one
 * Gemini call's worth of work — but clip detection previously only saw
 * `summary` and `topics`, discarding all of it. These four categories are
 * the most directly load-bearing for "hook + story" clips that have a
 * real shot at retention, so they're surfaced here as concrete anchors
 * the model can build a clip span around, instead of re-deriving them
 * from scratch by re-reading the full transcript.
 */
function formatAnalysisSignals(analysis) {
  const sections = [
    ['Notable stories/anecdotes', formatSignalList(analysis.stories)],
    ['Memorable quotes', formatSignalList(analysis.memorableQuotes)],
    ['Surprising statements', formatSignalList(analysis.surprisingStatements)],
    ['Strong opinions/hot takes', formatSignalList(analysis.strongOpinions)],
  ].filter(([, list]) => list);

  if (sections.length === 0) return '';
  return `\n\n${sections.map(([label, list]) => `${label}:\n${list}`).join('\n\n')}`;
}

function buildPrompt(transcript, analysis) {
  const topicsLine = (analysis.topics || []).join(', ');
  const signalsBlock = formatAnalysisSignals(analysis);
  return `Given this video transcript and its analysis, identify 3-10 potential short-form clip moments optimized for retention on platforms like TikTok, Reels and Shorts, where a viewer decides whether to keep watching within the first 1-3 seconds.

A clip built around a real story, a surprising statement, a bold opinion, or a memorable quote almost always outperforms a clip that only explains a topic — prefer anchoring clips on the specific moments listed below (when present) over generic topic explanation. Each listed moment includes its approximate timestamp as a starting reference point; use it to locate the real startMs/endMs span in the transcript (the listed timestamp may not be the ideal clip boundary itself).${signalsBlock}

For each clip, choose a startMs/endMs span where the FIRST THING SAID is itself a hook — do not pick a span whose opening line is throat-clearing, a transition ("so anyway"), or a restatement of something said earlier. If the strongest hook line in a segment comes a few seconds after where the idea technically begins, move the clip's start to that line rather than including the lead-up.

The "hook" field must be the literal opening words a viewer will hear, verbatim from the transcript — not a paraphrase or a title. A strong hook is usually one of:
- a direct, specific claim that sounds surprising or counterintuitive ("Most people get this backwards")
- a question the viewer wants answered ("Why does this always happen right before...")
- a concrete number or stat stated up front ("Three things killed this project, and the first one isn't what you'd guess")
- the consequence stated before the explanation ("This one mistake cost us six months")
- direct address naming the viewer's situation ("If you've ever tried to do X and failed...")

Avoid hooks that are generic scene-setting ("Today I want to talk about..."), that bury the interesting part after a throat-clear, or that only make sense with context the clip doesn't include.

Each clip should also: contain one complete idea, work without needing outside context, end on a real conclusion rather than mid-sentence, and avoid starting or ending mid-sentence. Ideal duration is 15-90 seconds.

Key topics: ${topicsLine}
Summary: ${analysis.summary}

Full transcript:
${delimitTranscript(transcript.fullText)}`;
}

/**
 * Detects clip candidates: asks the AI for proposals, then runs every
 * proposal through deterministic clamping/merging/scoring
 * (src/clips/candidates.js) before anything is trusted or persisted —
 * see docs/AI.md §4.
 */
async function detectClips({ provider, transcript, analysis, userId, processingJobId }) {
  const { data } = await callStructured({
    provider,
    prompt: buildPrompt(transcript, analysis),
    systemPrompt: UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT,
    jsonSchema: CLIP_CANDIDATES_JSON_SCHEMA,
    zodSchema: clipCandidatesSchema,
    maxTokens: 2048,
    userId,
    processingJobId,
  });

  const processed = processClipCandidates(data.clips, {
    transcript,
    durationMs: transcript.durationMs || transcript.segments[transcript.segments.length - 1]?.endMs || 0,
  });

  return processed;
}

async function persistClips(processingJobId, candidates) {
  return clipCandidateRepository.createMany(processingJobId, candidates);
}

module.exports = { detectClips, persistClips, buildPrompt, formatAnalysisSignals };
