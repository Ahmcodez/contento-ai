const { clipCandidatesSchema, CLIP_CANDIDATES_JSON_SCHEMA } = require('../ai/schemas');
const { callStructured } = require('../ai/reliableCall');
const { UNTRUSTED_TRANSCRIPT_SYSTEM_PROMPT, delimitTranscript } = require('../ai/promptSafety');
const { processClipCandidates } = require('../clips/candidates');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

function buildPrompt(transcript, analysis) {
  const topicsLine = (analysis.topics || []).join(', ');
  return `Given this video transcript and its analysis, identify 3-10 potential short-form clip moments optimized for retention on platforms like TikTok, Reels and Shorts, where a viewer decides whether to keep watching within the first 1-3 seconds.

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

module.exports = { detectClips, persistClips };
