const { buildTimedLines, formatTimedLines, chunkTimedLines, resolveLineSpan, locatePhraseStartMs } = require('../src/transcript/timed');

const seg = (startMs, endMs, text, words) => ({ startMs, endMs, text, wordTimestamps: words });
const words = (...triples) => triples.map(([word, startMs, endMs]) => ({ word, startMs, endMs }));

describe('buildTimedLines', () => {
  it('merges tiny segments into one line, keeping the true start and end', () => {
    const lines = buildTimedLines([seg(0, 800, 'So'), seg(800, 1500, 'anyway'), seg(1500, 4000, 'this is the part that actually matters to everyone here.')]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 0, startMs: 0, endMs: 4000 });
    expect(lines[0].text).toBe('So anyway this is the part that actually matters to everyone here.');
  });

  it('numbers lines from 0 in order and never exceeds the max line length', () => {
    const sentence = 'This is a reasonably long sentence about something. ';
    const lines = buildTimedLines(Array.from({ length: 12 }, (_, i) => seg(i * 5000, i * 5000 + 4800, sentence.repeat(2))));
    expect(lines.map((l) => l.id)).toEqual(lines.map((_, i) => i));
    expect(Math.max(...lines.map((l) => l.text.length))).toBeLessThanOrEqual(260 + 120); // one segment can exceed it alone, never two
    expect(lines.length).toBe(12);
  });

  it('skips empty segments and carries word timings through', () => {
    const w = words(['Hello', 100, 400], ['there', 400, 800]);
    const lines = buildTimedLines([seg(0, 50, '   '), seg(100, 800, 'Hello there, this line is long enough to close by itself okay.', w)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].words).toEqual(w);
  });

  it('returns nothing for an empty transcript', () => {
    expect(buildTimedLines([])).toEqual([]);
  });
});

describe('formatTimedLines', () => {
  it('prefixes each line with its id', () => {
    expect(formatTimedLines([{ id: 0, text: 'a' }, { id: 1, text: 'b' }])).toBe('[0] a\n[1] b');
  });
});

describe('time markers', () => {
  const mk = (i, ms) => ({ id: i, startMs: ms, endMs: ms + 1000, text: `line ${i}`, words: [] });

  it('drops a marker about every interval, labelled with the real time of the line after it', () => {
    const lines = [mk(0, 0), mk(1, 20000), mk(2, 61000), mk(3, 70000), mk(4, 125500), mk(5, 3725000)];
    expect(formatTimedLines(lines, { markEveryMs: 60000 }).split('\n')).toEqual([
      '[0] line 0',
      '[1] line 1',
      '-- 1:01 --',
      '[2] line 2',
      '[3] line 3',
      '-- 2:05 --',
      '[4] line 4',
      '-- 1:02:05 --',
      '[5] line 5',
    ]);
  });

  it('adds only a few percent to the size of a realistic transcript', () => {
    const lines = Array.from({ length: 600 }, (_, i) => mk(i, i * 12000)).map((l) => ({ ...l, text: 'word '.repeat(22).trim() }));
    const plain = formatTimedLines(lines).length;
    const marked = formatTimedLines(lines, { markEveryMs: 60000 }).length;
    expect((marked - plain) / plain).toBeLessThan(0.05);
  });
});

describe('chunkTimedLines', () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ id: i, startMs: i * 1000, endMs: i * 1000 + 900, text: 'x'.repeat(50), words: [] }));

  it('splits by size while keeping ids global and boundaries exact', () => {
    const chunks = chunkTimedLines(lines, { maxCharsPerChunk: 200, maxChunks: 10, markEveryMs: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.lines.map((l) => l.id))).toEqual(lines.map((l) => l.id));
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(200);
      expect(c.startMs).toBe(c.lines[0].startMs);
      expect(c.endMs).toBe(c.lines[c.lines.length - 1].endMs);
    }
    expect(chunks[1].text.startsWith(`[${chunks[1].lines[0].id}]`)).toBe(true);
  });

  it('fails with TRANSCRIPT_TOO_LONG instead of silently dropping the rest', () => {
    expect(() => chunkTimedLines(lines, { maxCharsPerChunk: 100, maxChunks: 2 })).toThrow(expect.objectContaining({ code: 'TRANSCRIPT_TOO_LONG' }));
  });
});

describe('resolveLineSpan', () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({ id: i }));

  it('returns the lines between two ids, inclusive', () => {
    expect(resolveLineSpan(lines, 1, 3)).toMatchObject({ startLine: 1, endLine: 3 });
    expect(resolveLineSpan(lines, 1, 3).lines.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it('tolerates reversed ids, a missing end, numeric strings and slightly-out-of-range ids', () => {
    expect(resolveLineSpan(lines, 3, 1)).toMatchObject({ startLine: 1, endLine: 3 });
    expect(resolveLineSpan(lines, 2)).toMatchObject({ startLine: 2, endLine: 2 });
    expect(resolveLineSpan(lines, '1', '2')).toMatchObject({ startLine: 1, endLine: 2 });
    expect(resolveLineSpan(lines, -2, 99)).toMatchObject({ startLine: 0, endLine: 4 });
  });

  it('rejects ids that point at nothing', () => {
    expect(resolveLineSpan(lines, 'abc', 2)).toBeNull();
    expect(resolveLineSpan(lines, 50, 60)).toBeNull();
    expect(resolveLineSpan([], 0, 1)).toBeNull();
  });
});

describe('locatePhraseStartMs', () => {
  const lines = [
    { id: 0, words: words(['So', 0, 200], ['anyway', 200, 700], ['we', 700, 800]) },
    { id: 1, words: words(['Most', 5000, 5300], ['people', 5300, 5700], ['get', 5700, 5900], ['this', 5900, 6100], ['backwards.', 6100, 6800]) },
  ];

  it('finds the word where the hook is actually spoken, ignoring case and punctuation', () => {
    expect(locatePhraseStartMs(lines, 'most people get this backwards')).toBe(5000);
    expect(locatePhraseStartMs(lines, 'MOST, people: get this backwards!')).toBe(5000);
  });

  it('returns null when the phrase is not there or there is no word timing', () => {
    expect(locatePhraseStartMs(lines, 'nothing like that was said')).toBeNull();
    expect(locatePhraseStartMs([{ id: 0, words: [] }], 'most people get')).toBeNull();
    expect(locatePhraseStartMs(lines, '')).toBeNull();
  });
});
