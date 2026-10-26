const config = require('../config');
const { scoreClipCandidate } = require('./scoring');
const { resolveLineSpan, locatePhraseStartMs, normalizeToken } = require('../transcript/timed');

/**
 * Turns the model's clip proposals (line spans) into real clips, then picks the ones
 * to keep. This is the "AI proposes, code disposes" step (docs/AI.md §4): the model
 * says where the hook line and the end of the explanation are; everything about exact
 * times, length limits, overlap and how many to keep is decided here, in code.
 */

const PRE_ROLL_MS = 200; // start just before the hook's first word, not on top of it
const TAIL_MS = 250; // let the last word finish
const MAX_GAP_MS = 4000; // don't stretch a clip across a long silence or cut
const MAX_SENTENCE_FIX_LINES = 2; // lines we'll add just to finish a sentence
const SENTENCE_END = /[.!?]["')\]]?$/;
const HOOK_OVERLAP_THRESHOLD = 0.6;

const isSentenceEnd = (text) => SENTENCE_END.test(String(text).trim());

function tokens(text) {
  return String(text || '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

/** Share of the hook's words that appear in the opening lines (used when word timing isn't available). */
function hookOverlap(hook, openingText) {
  const hookTokens = tokens(hook);
  if (hookTokens.length === 0) return 0;
  const opening = new Set(tokens(openingText));
  return hookTokens.filter((t) => opening.has(t)).length / hookTokens.length;
}

function firstSentence(text, maxChars = 160) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : trimmed;
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trim()}…` : sentence;
}

/**
 * One proposal -> one scored candidate, or null if it can't be made into a usable clip.
 *  - starts on the hook's first spoken word (not the start of the line it's in)
 *  - ends where the explanation ends, nudged to finish the sentence
 *  - extended if too short, trimmed back to a sentence end if too long
 */
function proposalToCandidate(proposal, lines, { durationMs }) {
  const span = resolveLineSpan(lines, proposal.startLine, proposal.endLine);
  if (!span) return null;

  const minMs = config.limits.clipMinDurationSeconds * 1000;
  const maxMs = config.limits.clipMaxDurationSeconds * 1000;

  const startIdx = span.startLine;
  let endIdx = span.endLine;

  // --- start: on the hook's first word when we can find it
  const openingLines = lines.slice(startIdx, startIdx + 2);
  const spokenAtMs = locatePhraseStartMs(openingLines, proposal.hook);
  let startMs = lines[startIdx].startMs;
  let hookVerified;
  if (spokenAtMs !== null) {
    startMs = Math.max(lines[startIdx].startMs, spokenAtMs - PRE_ROLL_MS);
    hookVerified = true;
  } else {
    hookVerified = hookOverlap(proposal.hook, openingLines.map((l) => l.text).join(' ')) >= HOOK_OVERLAP_THRESHOLD;
  }
  // The schema promises a verbatim hook. If the model paraphrased, show what is actually said.
  const hook = hookVerified ? proposal.hook : firstSentence(lines[startIdx].text);

  // --- end
  let endMs = lines[endIdx].endMs;

  // too short: pull in following lines (unless that crosses a gap or the length cap)
  while (endMs - startMs < minMs && endIdx + 1 < lines.length) {
    const next = lines[endIdx + 1];
    if (next.startMs - endMs > MAX_GAP_MS || next.endMs - startMs > maxMs) break;
    endIdx += 1;
    endMs = next.endMs;
  }

  // not ending on a sentence: borrow a line or two to finish it
  for (let extra = 0; extra < MAX_SENTENCE_FIX_LINES && !isSentenceEnd(lines[endIdx].text) && endIdx + 1 < lines.length; extra += 1) {
    const next = lines[endIdx + 1];
    if (next.startMs - endMs > MAX_GAP_MS || next.endMs - startMs > maxMs) break;
    endIdx += 1;
    endMs = next.endMs;
  }

  // too long: back up to the last sentence end that fits, else the last line that fits
  if (endMs - startMs > maxMs) {
    let i = endIdx;
    while (i > startIdx && lines[i].endMs - startMs > maxMs) i -= 1;
    let j = i;
    while (j > startIdx && !isSentenceEnd(lines[j].text)) j -= 1;
    if (j > startIdx && lines[j].endMs - startMs >= minMs) i = j;
    endIdx = i;
    endMs = Math.min(lines[i].endMs, startMs + maxMs);
  }

  const nextStart = lines[endIdx + 1]?.startMs ?? durationMs;
  endMs = Math.min(endMs + TAIL_MS, Math.max(endMs, nextStart), durationMs || Infinity);
  if (endMs <= startMs) return null;

  const text = lines
    .slice(startIdx, endIdx + 1)
    .map((l) => l.text)
    .join(' ');

  const candidate = {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    title: String(proposal.title || 'Untitled clip').slice(0, 200),
    hook: hook.slice(0, 500),
    summary: proposal.summary?.slice(0, 1000),
    reason: proposal.reason?.slice(0, 500),
    topic: proposal.topic?.slice(0, 200),
    aiScore: proposal.score,
    text,
    // Starting on the hook's own word is a clean start by design, not a mid-sentence cut.
    startsOnBoundary: spokenAtMs !== null || startMs === lines[startIdx].startMs,
    endsOnBoundary: isSentenceEnd(lines[endIdx].text),
    hookVerified,
    startLine: startIdx,
    endLine: endIdx,
  };

  const { finalScore, breakdown } = scoreClipCandidate(candidate);
  // scoreBreakdown is the name the repository persists (it used to be dropped here).
  return { ...candidate, finalScore, scoreBreakdown: breakdown };
}

const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * Picks `count` clips from the candidates. Never overlapping, and spread across the
 * video: the timeline is cut into `count` equal slices and the best clip in each slice
 * is taken first, so a long video is broken up across its length instead of piling up
 * wherever the model found the most hooks. Remaining places go to the best leftovers.
 * Candidates under the quality floor are never used, so asking for 8 clips from a video
 * with 5 good ones returns 5 rather than padding with weak ones.
 */
function selectClips(candidates, { count, durationMs }) {
  const floor = config.limits.clipMinFinalScore;
  const target = Math.min(count, config.limits.maxClipsPerVideo);
  const pool = candidates.filter((c) => c.finalScore >= floor).sort((a, b) => b.finalScore - a.finalScore);

  const chosen = [];
  const canTake = (c) => !chosen.some((picked) => overlaps(picked, c));

  if (target > 1 && durationMs > 0) {
    const slice = durationMs / target;
    for (let i = 0; i < target; i += 1) {
      const from = i * slice;
      const to = from + slice;
      const best = pool.find((c) => {
        const mid = (c.startMs + c.endMs) / 2;
        return mid >= from && mid < to && canTake(c);
      });
      if (best) chosen.push(best);
    }
  }

  for (const c of pool) {
    if (chosen.length >= target) break;
    if (!chosen.includes(c) && canTake(c)) chosen.push(c);
  }

  return chosen.sort((a, b) => b.finalScore - a.finalScore);
}

/** Proposals -> usable candidates (every one that survives), unselected. */
function buildCandidates(proposals, lines, { durationMs }) {
  return (proposals || []).map((p) => proposalToCandidate(p, lines, { durationMs })).filter(Boolean);
}

module.exports = { proposalToCandidate, buildCandidates, selectClips, hookOverlap, firstSentence };
