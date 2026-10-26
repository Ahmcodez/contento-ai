const config = require('../src/config');
const { buildTimedLines } = require('../src/transcript/timed');
const { proposalToCandidate, buildCandidates, selectClips, hookOverlap, firstSentence } = require('../src/clips/select');

const MIN_MS = config.limits.clipMinDurationSeconds * 1000;
const MAX_MS = config.limits.clipMaxDurationSeconds * 1000;
const SEG_MS = 6000;

const defaultText = (i) => `Statement ${i} continues with enough extra words to make it a full line of speech.`;

/** Segment i covers [i*6s, i*6s+5.8s) with word timestamps spread evenly across it. */
function makeSegments(count, textFor = defaultText) {
  return Array.from({ length: count }, (_, i) => {
    const text = textFor(i);
    const startMs = i * SEG_MS;
    const parts = text.split(' ');
    const step = 5800 / parts.length;
    return {
      startMs,
      endMs: startMs + 5800,
      text,
      wordTimestamps: parts.map((word, k) => ({ word, startMs: Math.round(startMs + k * step), endMs: Math.round(startMs + (k + 1) * step) })),
    };
  });
}

const linesFor = (count, textFor) => buildTimedLines(makeSegments(count, textFor));
const proposal = (overrides = {}) => ({ startLine: 2, endLine: 6, hook: 'Statement 2 continues with enough', title: 'A clip', score: 80, ...overrides });

describe('proposalToCandidate: where the clip starts', () => {
  const text = (i) => (i === 4 ? 'Well you know it was a long day. Most people get this backwards and it costs them years.' : defaultText(i));

  it('starts on the first word of the hook, not at the start of the line the hook sits in', () => {
    const lines = linesFor(30, text);
    const c = proposalToCandidate(proposal({ startLine: 4, endLine: 9, hook: 'Most people get this backwards' }), lines, { durationMs: 180000 });

    const hookWord = lines[4].words.find((w) => w.word === 'Most');
    expect(c.startMs).toBe(hookWord.startMs - 200);
    expect(c.startMs).toBeGreaterThan(lines[4].startMs); // skipped "Well you know it was a long day."
    expect(c.hook).toBe('Most people get this backwards');
    expect(c.hookVerified).toBe(true);
    expect(c.startsOnBoundary).toBe(true);
  });

  it('starts at the line start when the hook is the first thing said on that line', () => {
    const lines = linesFor(30);
    const c = proposalToCandidate(proposal(), lines, { durationMs: 180000 });
    expect(c.startMs).toBe(lines[2].startMs);
  });

  it('replaces a paraphrased hook with what is actually said, instead of showing words nobody spoke', () => {
    const lines = linesFor(30);
    const c = proposalToCandidate(proposal({ hook: 'A shocking secret that nobody talks about' }), lines, { durationMs: 180000 });
    expect(c.hookVerified).toBe(false);
    expect(c.hook).toBe('Statement 2 continues with enough extra words to make it a full line of speech.');
  });

  it('still accepts a hook that matches the opening words when the transcript has no word timing', () => {
    const lines = buildTimedLines(makeSegments(30).map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })));
    const c = proposalToCandidate(proposal(), lines, { durationMs: 180000 });
    expect(c.hookVerified).toBe(true);
    expect(c.startMs).toBe(lines[2].startMs);
  });
});

describe('proposalToCandidate: where the clip ends', () => {
  it('ends where the explanation ends (last line of the span, plus a short tail), not later', () => {
    const lines = linesFor(40);
    const c = proposalToCandidate(proposal({ startLine: 2, endLine: 8 }), lines, { durationMs: 240000 });
    expect(c.endMs).toBe(lines[8].endMs + 200); // line 8 ends at 53.8s, the next line starts at 54s: tail is capped at that
    expect(c.endMs).toBeLessThanOrEqual(lines[9].startMs);
    expect(c.endLine).toBe(8);
  });

  it('pulls in following lines when the proposal is shorter than the minimum', () => {
    const lines = linesFor(40);
    const c = proposalToCandidate(proposal({ startLine: 2, endLine: 3 }), lines, { durationMs: 240000 });
    expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(MIN_MS);
    expect(c.endLine).toBeGreaterThan(3);
  });

  it('does not stretch across a long silence just to reach the minimum', () => {
    const segments = makeSegments(40);
    for (let i = 4; i < segments.length; i += 1) {
      segments[i].startMs += 30000;
      segments[i].endMs += 30000;
      segments[i].wordTimestamps = segments[i].wordTimestamps.map((w) => ({ ...w, startMs: w.startMs + 30000, endMs: w.endMs + 30000 }));
    }
    const c = proposalToCandidate(proposal({ startLine: 2, endLine: 3 }), buildTimedLines(segments), { durationMs: 300000 });
    expect(c.endLine).toBe(3);
  });

  it('trims a proposal that is too long back to a sentence end inside the maximum', () => {
    const lines = linesFor(60);
    const c = proposalToCandidate(proposal({ startLine: 0, endLine: 40 }), lines, { durationMs: 400000 });
    expect(c.endMs - c.startMs).toBeLessThanOrEqual(MAX_MS + 250);
    expect(c.endMs - c.startMs).toBeGreaterThan(MIN_MS);
    expect(c.endsOnBoundary).toBe(true);
  });

  it('borrows a line or two to finish a sentence rather than stopping mid-sentence', () => {
    const text = (i) => (i === 8 ? 'This explanation is not finished yet because it keeps going without a full stop' : i === 9 ? 'and now it ends properly right here.' : defaultText(i));
    const lines = linesFor(40, text);
    const c = proposalToCandidate(proposal({ startLine: 2, endLine: 8 }), lines, { durationMs: 240000 });
    expect(c.endLine).toBe(9);
    expect(c.endsOnBoundary).toBe(true);
  });

  it('never runs past the end of the video', () => {
    const lines = linesFor(10);
    const c = proposalToCandidate(proposal({ startLine: 5, endLine: 9 }), lines, { durationMs: lines[9].endMs });
    expect(c.endMs).toBeLessThanOrEqual(lines[9].endMs);
  });
});

describe('proposalToCandidate: bad input and output shape', () => {
  it('drops proposals whose line ids point at nothing', () => {
    expect(proposalToCandidate(proposal({ startLine: 500, endLine: 510 }), linesFor(10), { durationMs: 60000 })).toBeNull();
  });

  it('carries a score and the breakdown that explains it (the breakdown used to be silently dropped)', () => {
    const c = proposalToCandidate(proposal(), linesFor(30), { durationMs: 180000 });
    expect(c.finalScore).toBeGreaterThan(0);
    expect(c.scoreBreakdown).toEqual(expect.objectContaining({ durationFit: expect.any(Number), hookPresence: expect.any(Number) }));
    expect(c.text).toContain('Statement 2');
  });
});

describe('helpers', () => {
  it('hookOverlap measures how much of the hook is in the opening text', () => {
    expect(hookOverlap('most people get this backwards', 'Most people get this backwards, really.')).toBe(1);
    expect(hookOverlap('most people get this backwards', 'completely different words here')).toBe(0);
    expect(hookOverlap('', 'anything')).toBe(0);
  });

  it('firstSentence takes the first sentence and caps the length', () => {
    expect(firstSentence('One thing. Another thing.')).toBe('One thing.');
    expect(firstSentence('x'.repeat(400)).length).toBeLessThanOrEqual(160);
  });
});

describe('selectClips', () => {
  const clip = (startS, endS, finalScore) => ({ startMs: startS * 1000, endMs: endS * 1000, finalScore, title: `${startS}` });
  const DURATION = 3600000; // one hour

  it('returns exactly the number asked for when there are enough good clips', () => {
    const pool = Array.from({ length: 12 }, (_, i) => clip(i * 280, i * 280 + 40, 70 + i));
    expect(selectClips(pool, { count: 5, durationMs: DURATION })).toHaveLength(5);
  });

  it('spreads the picks across the video instead of bunching them where the scores happen to be highest', () => {
    // The five best-scoring clips are all in the first ten minutes.
    const bunched = [0, 100, 200, 300, 400].map((s, i) => clip(s, s + 40, 95 - i));
    const spread = [700, 1500, 2300, 3100].map((s) => clip(s, s + 40, 60));
    const picked = selectClips([...bunched, ...spread], { count: 5, durationMs: DURATION });

    const slice = DURATION / 5;
    const slicesHit = new Set(picked.map((c) => Math.floor((c.startMs + c.endMs) / 2 / slice)));
    expect(slicesHit.size).toBe(5);
  });

  it('never returns overlapping clips', () => {
    const pool = [clip(100, 160, 90), clip(130, 190, 88), clip(150, 210, 85), clip(400, 450, 70)];
    const picked = selectClips(pool, { count: 4, durationMs: DURATION });
    for (let i = 0; i < picked.length; i += 1) {
      for (let j = i + 1; j < picked.length; j += 1) {
        expect(picked[i].startMs < picked[j].endMs && picked[j].startMs < picked[i].endMs).toBe(false);
      }
    }
    expect(picked.map((c) => c.title).sort()).toEqual(['100', '400']);
  });

  it('returns fewer rather than padding with weak clips below the quality floor', () => {
    const floor = config.limits.clipMinFinalScore;
    const pool = [clip(100, 140, 80), clip(900, 940, 75), clip(1800, 1840, floor - 5), clip(2600, 2640, floor - 20)];
    const picked = selectClips(pool, { count: 4, durationMs: DURATION });
    expect(picked.map((c) => c.title)).toEqual(['100', '900']);
  });

  it('returns the single best clip when one is asked for', () => {
    const picked = selectClips([clip(10, 50, 60), clip(2000, 2040, 91), clip(3000, 3040, 70)], { count: 1, durationMs: DURATION });
    expect(picked.map((c) => c.title)).toEqual(['2000']);
  });

  it('is ordered best first, and never exceeds the configured maximum', () => {
    const pool = Array.from({ length: 60 }, (_, i) => clip(i * 55, i * 55 + 40, 40 + (i % 50)));
    const picked = selectClips(pool, { count: 500, durationMs: DURATION });
    expect(picked.length).toBeLessThanOrEqual(config.limits.maxClipsPerVideo);
    expect(picked.map((c) => c.finalScore)).toEqual([...picked.map((c) => c.finalScore)].sort((a, b) => b - a));
  });

  it('handles nothing to choose from', () => {
    expect(selectClips([], { count: 5, durationMs: DURATION })).toEqual([]);
  });
});

describe('buildCandidates', () => {
  it('keeps the proposals that make usable clips and silently skips the rest', () => {
    const lines = linesFor(40);
    const out = buildCandidates([proposal({ startLine: 2, endLine: 8 }), proposal({ startLine: 900, endLine: 905 })], lines, { durationMs: 240000 });
    expect(out).toHaveLength(1);
  });
  it('copes with no proposals at all', () => {
    expect(buildCandidates(undefined, linesFor(5), { durationMs: 30000 })).toEqual([]);
  });
});
