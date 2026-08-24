const { normalizeTranscript, segmentsInRange } = require('../src/transcript/normalize');
const { chunkTranscript } = require('../src/transcript/chunk');

describe('normalizeTranscript', () => {
  it('normalizes seconds-based provider output to milliseconds', () => {
    const raw = {
      fullText: 'hello world',
      language: 'en',
      segments: [{ start: 0.5, end: 2.25, text: ' hello ' }],
    };
    const result = normalizeTranscript(raw);
    expect(result.segments[0].startMs).toBe(500);
    expect(result.segments[0].endMs).toBe(2250);
    expect(result.segments[0].text).toBe('hello');
  });

  it('normalizes millisecond-based provider output directly', () => {
    const raw = { segments: [{ startMs: 1000, endMs: 2000, text: 'hi' }] };
    const result = normalizeTranscript(raw);
    expect(result.segments[0].startMs).toBe(1000);
    expect(result.segments[0].endMs).toBe(2000);
  });

  it('drops segments with zero or negative duration', () => {
    const raw = {
      segments: [
        { startMs: 1000, endMs: 1000, text: 'zero duration' },
        { startMs: 2000, endMs: 1500, text: 'negative duration' },
        { startMs: 3000, endMs: 4000, text: 'valid' },
      ],
    };
    const result = normalizeTranscript(raw);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('valid');
  });

  it('drops segments with empty text', () => {
    const raw = { segments: [{ startMs: 0, endMs: 1000, text: '   ' }] };
    const result = normalizeTranscript(raw);
    expect(result.segments).toHaveLength(0);
  });

  it('sorts segments by start time even if the provider returns them out of order', () => {
    const raw = {
      segments: [
        { startMs: 5000, endMs: 6000, text: 'second' },
        { startMs: 0, endMs: 1000, text: 'first' },
      ],
    };
    const result = normalizeTranscript(raw);
    expect(result.segments.map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('derives fullText from segments when the provider does not supply it', () => {
    const raw = { segments: [{ startMs: 0, endMs: 1000, text: 'a' }, { startMs: 1000, endMs: 2000, text: 'b' }] };
    const result = normalizeTranscript(raw);
    expect(result.fullText).toBe('a b');
  });

  it('normalizes word-level timestamps when present', () => {
    const raw = {
      segments: [{ startMs: 0, endMs: 1000, text: 'hi there', words: [{ word: 'hi', start: 0, end: 0.4 }] }],
    };
    const result = normalizeTranscript(raw);
    expect(result.segments[0].wordTimestamps[0]).toEqual({ word: 'hi', startMs: 0, endMs: 400 });
  });

  it('sets durationMs from the last segment', () => {
    const raw = { segments: [{ startMs: 0, endMs: 1000, text: 'a' }, { startMs: 1000, endMs: 5000, text: 'b' }] };
    const result = normalizeTranscript(raw);
    expect(result.durationMs).toBe(5000);
  });

  it('handles an empty transcript gracefully', () => {
    const result = normalizeTranscript({ segments: [] });
    expect(result.segments).toEqual([]);
    expect(result.durationMs).toBe(0);
  });
});

describe('segmentsInRange', () => {
  const segments = [
    { startMs: 0, endMs: 1000, text: 'a' },
    { startMs: 1000, endMs: 2000, text: 'b' },
    { startMs: 5000, endMs: 6000, text: 'c' },
  ];

  it('returns segments overlapping the given range', () => {
    expect(segmentsInRange(segments, 500, 1500).map((s) => s.text)).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing overlaps', () => {
    expect(segmentsInRange(segments, 2000, 5000)).toEqual([]);
  });
});

describe('chunkTranscript', () => {
  function makeSegments(count, textLength = 50) {
    const text = 'w'.repeat(textLength);
    return Array.from({ length: count }, (_, i) => ({ startMs: i * 1000, endMs: (i + 1) * 1000, text }));
  }

  it('keeps a short transcript in a single chunk', () => {
    const segments = makeSegments(5, 20);
    const chunks = chunkTranscript(segments, { maxCharsPerChunk: 10000, maxChunks: 10 });
    expect(chunks).toHaveLength(1);
  });

  it('splits a long transcript into multiple chunks bounded by maxCharsPerChunk', () => {
    const segments = makeSegments(20, 100); // ~2000 chars total
    const chunks = chunkTranscript(segments, { maxCharsPerChunk: 500, maxChunks: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(600); // allows one segment over before splitting
    }
  });

  it('never splits in the middle of a segment', () => {
    const segments = makeSegments(10, 100);
    const chunks = chunkTranscript(segments, { maxCharsPerChunk: 250, maxChunks: 10 });
    const totalSegmentsInChunks = chunks.reduce((sum, c) => sum + c.segmentCount, 0);
    expect(totalSegmentsInChunks).toBe(10);
  });

  it('throws a cost-control error when the transcript would need too many chunks', () => {
    const segments = makeSegments(100, 200);
    expect(() => chunkTranscript(segments, { maxCharsPerChunk: 500, maxChunks: 3 })).toThrow('too long to process');
  });

  it('returns an empty array for an empty transcript', () => {
    expect(chunkTranscript([], { maxCharsPerChunk: 1000, maxChunks: 5 })).toEqual([]);
  });

  it('preserves chunk start/end timestamps', () => {
    const segments = makeSegments(3, 10);
    const chunks = chunkTranscript(segments, { maxCharsPerChunk: 10000, maxChunks: 5 });
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[0].endMs).toBe(3000);
  });
});
