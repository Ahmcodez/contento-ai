const { scoreClipCandidate } = require('../src/clips/scoring');
const { processClipCandidates, clampCandidate, mergeOverlapping } = require('../src/clips/candidates');

describe('scoreClipCandidate', () => {
  it('gives full duration-fit score for a clip inside the ideal range', () => {
    const { breakdown } = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'A complete idea here.' });
    expect(breakdown.durationFit).toBe(100);
  });

  it('penalizes a clip that is much too short', () => {
    const { breakdown } = scoreClipCandidate({ startMs: 0, endMs: 2000, text: 'Too short.' });
    expect(breakdown.durationFit).toBeLessThan(100);
  });

  it('penalizes a clip that is much too long', () => {
    const { breakdown } = scoreClipCandidate({ startMs: 0, endMs: 300000, text: 'Way too long for a short clip.' });
    expect(breakdown.durationFit).toBeLessThan(100);
  });

  it('penalizes text that opens on a dependent word (mid-thought)', () => {
    const { breakdown } = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'And that is why it matters.' });
    expect(breakdown.contextIndependence).toBeLessThan(100);
  });

  it('rewards text that opens and closes cleanly', () => {
    const { breakdown } = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'This is a complete standalone idea.' });
    expect(breakdown.contextIndependence).toBe(100);
  });

  it('penalizes clips that do not start or end on a sentence boundary', () => {
    const { breakdown } = scoreClipCandidate({
      startMs: 0,
      endMs: 30000,
      text: 'partial sentence',
      startsOnBoundary: false,
      endsOnBoundary: false,
    });
    expect(breakdown.sentenceBoundary).toBe(40);
  });

  it('rewards a clip with a hook present', () => {
    const withHook = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'Text.', hook: 'A strong opening line' });
    const withoutHook = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'Text.' });
    expect(withHook.breakdown.hookPresence).toBeGreaterThan(withoutHook.breakdown.hookPresence);
  });

  describe('hook quality (not just presence)', () => {
    const base = { startMs: 0, endMs: 30000, text: 'Text.' };
    const hookScore = (hook) => scoreClipCandidate({ ...base, hook }).breakdown.hookPresence;

    it('scores 0 for a missing/empty hook', () => {
      expect(hookScore('')).toBe(0);
      expect(hookScore('   ')).toBe(0);
      expect(hookScore(undefined)).toBe(0);
    });

    it('scores a question-style hook above baseline', () => {
      expect(hookScore('Why does this always happen right before a launch?')).toBeGreaterThan(65);
    });

    it('scores a hook with a concrete number above baseline, digit or spelled out', () => {
      expect(hookScore('3 things killed this project in one week.')).toBeGreaterThan(65);
      expect(hookScore('Three things killed this project in one week.')).toBeGreaterThan(65);
    });

    it('scores a direct-address hook above baseline', () => {
      expect(hookScore('If you have ever tried this and failed, here is why.')).toBeGreaterThan(65);
    });

    it('scores a surprise/contrast-framed hook above baseline', () => {
      expect(hookScore('Most people get this backwards and it costs them years.')).toBeGreaterThan(65);
    });

    it('penalizes a generic throat-clearing opening below baseline', () => {
      expect(hookScore('So anyway, today I want to talk about marketing.')).toBeLessThan(65);
      expect(hookScore('Hi everyone, welcome back to the channel.')).toBeLessThan(65);
      expect(hookScore('Okay so basically this is a thing.')).toBeLessThan(65);
    });

    it('penalizes a hook that is too short to be a real claim', () => {
      expect(hookScore('Hooks.')).toBeLessThan(65);
      expect(hookScore('Hi there')).toBeLessThan(65);
    });

    it('penalizes a hook that is too long to be punchy', () => {
      expect(hookScore('word '.repeat(45).trim())).toBeLessThan(65);
    });

    it('stays within 0-100 for a hook with many strong signals stacked', () => {
      const score = hookScore('Why do most people get this backwards? Here is why 3 things cost you years, and what you should do.');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('a clean, well-formed hook with no special signal lands at the baseline, not penalized', () => {
      expect(hookScore('This changed how I think about the whole process.')).toBe(65);
    });
  });

  it('produces a final score between 0 and 100', () => {
    const { finalScore } = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'Some reasonable text here.' });
    expect(finalScore).toBeGreaterThanOrEqual(0);
    expect(finalScore).toBeLessThanOrEqual(100);
  });

  it('never claims or implies virality — score is just a number, no label attached', () => {
    const result = scoreClipCandidate({ startMs: 0, endMs: 30000, text: 'Text.' });
    expect(result).not.toHaveProperty('viralityGuarantee');
    expect(Object.keys(result)).toEqual(['finalScore', 'breakdown']);
  });
});

describe('clampCandidate (timestamp validation)', () => {
  it('clamps a start before zero to zero', () => {
    const result = clampCandidate({ startMs: -5000, endMs: 10000, title: 'x' }, 60000);
    expect(result.startMs).toBe(0);
  });

  it('clamps an end beyond the video duration to the duration', () => {
    const result = clampCandidate({ startMs: 1000, endMs: 999999, title: 'x' }, 60000);
    expect(result.endMs).toBe(60000);
  });

  it('rejects a candidate where end is before start after clamping', () => {
    const result = clampCandidate({ startMs: 50000, endMs: 10000, title: 'x' }, 60000);
    expect(result).toBeNull();
  });

  it('rejects a candidate with non-numeric bounds', () => {
    expect(clampCandidate({ startMs: 'not a number', endMs: 10000, title: 'x' }, 60000)).toBeNull();
  });

  it('truncates an overly long title rather than rejecting the candidate', () => {
    const longTitle = 'x'.repeat(500);
    const result = clampCandidate({ startMs: 0, endMs: 10000, title: longTitle }, 60000);
    expect(result.title.length).toBeLessThanOrEqual(200);
  });

  it('defaults to a placeholder title if none is given', () => {
    const result = clampCandidate({ startMs: 0, endMs: 10000 }, 60000);
    expect(result.title).toBe('Untitled clip');
  });
});

describe('mergeOverlapping', () => {
  it('keeps two candidates that do not significantly overlap', () => {
    const candidates = [
      { startMs: 0, endMs: 10000, hook: 'a' },
      { startMs: 20000, endMs: 30000, hook: 'b' },
    ];
    expect(mergeOverlapping(candidates)).toHaveLength(2);
  });

  it('merges two candidates with more than 50% overlap, keeping the richer one', () => {
    const candidates = [
      { startMs: 0, endMs: 10000, hook: 'a', summary: 's', reason: 'r' },
      { startMs: 1000, endMs: 9000 }, // fully inside the first, no extra fields
    ];
    const result = mergeOverlapping(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].hook).toBe('a');
  });
});

describe('processClipCandidates (full pipeline)', () => {
  const transcript = {
    segments: [
      { startMs: 0, endMs: 5000, text: 'Intro segment.' },
      { startMs: 5000, endMs: 15000, text: 'The main story unfolds here.' },
      { startMs: 15000, endMs: 20000, text: 'A clean conclusion.' },
    ],
  };

  it('returns scored, ranked candidates sorted best-first', () => {
    const raw = [
      { startMs: 5000, endMs: 20000, title: 'Good clip', hook: 'A strong hook', estimatedQualityScore: 90 },
      { startMs: 0, endMs: 3000, title: 'Weak clip', estimatedQualityScore: 30 },
    ];
    const result = processClipCandidates(raw, { transcript, durationMs: 20000 });
    expect(result.length).toBeGreaterThan(0);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].finalScore).toBeGreaterThanOrEqual(result[i].finalScore);
    }
  });

  it('never returns more candidates than configured max clips per video', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 500,
      title: `clip ${i}`,
    }));
    const result = processClipCandidates(raw, { transcript, durationMs: 30000 });
    expect(result.length).toBeLessThanOrEqual(10); // MAX_CLIPS_PER_VIDEO default
  });

  it('drops candidates entirely outside the valid video duration', () => {
    const raw = [{ startMs: 100000, endMs: 200000, title: 'out of range' }];
    const result = processClipCandidates(raw, { transcript, durationMs: 20000 });
    expect(result).toHaveLength(0);
  });
});
