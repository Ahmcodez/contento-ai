const { wrapCaptionText, buildCaptionCues, buildWordLevelCues, cuesToSrt, msToSrtTimestamp } = require('../src/media/CaptionGenerator');

describe('CaptionGenerator', () => {
  describe('msToSrtTimestamp', () => {
    it('formats milliseconds as hh:mm:ss,ms', () => {
      expect(msToSrtTimestamp(0)).toBe('00:00:00,000');
      expect(msToSrtTimestamp(1500)).toBe('00:00:01,500');
      expect(msToSrtTimestamp(3661234)).toBe('01:01:01,234');
    });

    it('clamps negative values to zero rather than producing a malformed timestamp', () => {
      expect(msToSrtTimestamp(-500)).toBe('00:00:00,000');
    });
  });

  describe('wrapCaptionText', () => {
    it('keeps short text on one line', () => {
      const lines = wrapCaptionText('short text', { maxCharsPerLine: 30, maxLines: 2 });
      expect(lines).toEqual(['short text']);
    });

    it('wraps to multiple lines on word boundaries', () => {
      const lines = wrapCaptionText('one two three four five six', { maxCharsPerLine: 12, maxLines: 3 });
      for (const line of lines.slice(0, -1)) {
        expect(line.length).toBeLessThanOrEqual(12);
      }
      expect(lines.join(' ').split(' ')).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
    });

    it('never exceeds maxLines and does not silently drop words', () => {
      const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
      const lines = wrapCaptionText(text, { maxCharsPerLine: 10, maxLines: 2 });
      expect(lines.length).toBeLessThanOrEqual(2);
      // every word should still be present somewhere in the wrapped output
      const words = text.split(' ');
      const joined = lines.join(' ');
      for (const word of words) {
        expect(joined).toContain(word);
      }
    });

    it('handles a single very long word without crashing', () => {
      const lines = wrapCaptionText('supercalifragilisticexpialidocious', { maxCharsPerLine: 10, maxLines: 2 });
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe('buildCaptionCues', () => {
    const segments = [
      { startMs: 1000, endMs: 3000, text: 'hello world' },
      { startMs: 3000, endMs: 5000, text: 'second line' },
      { startMs: 20000, endMs: 22000, text: 'way outside range' },
    ];

    it('only includes segments overlapping the requested range', () => {
      const cues = buildCaptionCues(segments, { startMs: 1000, endMs: 6000 });
      expect(cues).toHaveLength(2);
    });

    it('rebases cue timestamps to clip-relative zero', () => {
      const cues = buildCaptionCues(segments, { startMs: 1000, endMs: 6000 });
      expect(cues[0].startMs).toBe(0);
      expect(cues[0].endMs).toBe(2000);
      expect(cues[1].startMs).toBe(2000);
    });

    it('clips a segment that partially overlaps the range boundary', () => {
      const cues = buildCaptionCues(segments, { startMs: 2000, endMs: 4000 });
      expect(cues[0].startMs).toBe(0); // clamped to range start
      expect(cues[0].endMs).toBe(1000);
    });
  });

  describe('buildCaptionCues with word-level timestamps (real feature: short, precisely-timed caption chunks)', () => {
    const words = (startMs, ...texts) => texts.map((word, i) => ({ word, startMs: startMs + i * 300, endMs: startMs + i * 300 + 250 }));

    const wordSegments = [
      {
        startMs: 1000,
        endMs: 3500,
        text: 'hello world this is a test',
        wordTimestamps: words(1000, 'hello', 'world', 'this', 'is', 'a', 'test'),
      },
    ];

    it('groups words into chunks of at most maxWordsPerCue, not one cue per whole segment', () => {
      const cues = buildCaptionCues(wordSegments, { startMs: 1000, endMs: 3500, style: { maxWordsPerCue: 2 } });
      expect(cues).toHaveLength(3); // 6 words / 2 per cue
      expect(cues[0].lines.join(' ')).toBe('hello world');
      expect(cues[1].lines.join(' ')).toBe('this is');
      expect(cues[2].lines.join(' ')).toBe('a test');
    });

    it('each cue is timed from its first word\'s real start to its last word\'s real end, not evenly divided', () => {
      const cues = buildCaptionCues(wordSegments, { startMs: 1000, endMs: 3500, style: { maxWordsPerCue: 2 } });
      // "hello" starts at 1000 (clip-relative 0), "world" ends at 1000+300+250=1550 (clip-relative 550)
      expect(cues[0].startMs).toBe(0);
      expect(cues[0].endMs).toBe(550);
    });

    it('defaults to config.captions.maxWordsPerCue when the style object has no override', () => {
      const cues = buildCaptionCues(wordSegments, { startMs: 1000, endMs: 3500 }); // default style = config.captions (maxWordsPerCue: 4)
      expect(cues).toHaveLength(2); // 6 words / 4 per cue = chunks of 4 and 2
      expect(cues[0].lines.join(' ').split(' ')).toHaveLength(4);
    });

    it('pools words across multiple overlapping segments into one evenly-grouped stream, not one cue-set per segment', () => {
      const segments = [
        { startMs: 0, endMs: 1500, text: 'one two', wordTimestamps: [{ word: 'one', startMs: 0, endMs: 400 }, { word: 'two', startMs: 500, endMs: 900 }] },
        { startMs: 1500, endMs: 3000, text: 'three', wordTimestamps: [{ word: 'three', startMs: 1500, endMs: 1900 }] },
      ];
      const cues = buildCaptionCues(segments, { startMs: 0, endMs: 3000, style: { maxWordsPerCue: 3 } });
      expect(cues).toHaveLength(1);
      expect(cues[0].lines.join(' ')).toBe('one two three'); // grouped across the segment boundary
    });

    it('clips words to the requested range and rebases timing to clip-relative zero', () => {
      const cues = buildCaptionCues(wordSegments, { startMs: 1300, endMs: 2000, style: { maxWordsPerCue: 10 } });
      const text = cues.map((c) => c.lines.join(' ')).join(' ');
      expect(text).not.toContain('hello'); // word ends at 1250, before the 1300 range start
      expect(cues[0].startMs).toBe(0); // clamped to range start, then rebased
    });

    it('falls back to one-cue-per-segment unchanged when wordTimestamps is absent (no regression for older transcripts)', () => {
      const plainSegments = [{ startMs: 1000, endMs: 3000, text: 'hello world' }];
      const cues = buildCaptionCues(plainSegments, { startMs: 1000, endMs: 3000 });
      expect(cues).toHaveLength(1);
      expect(cues[0].lines.join(' ')).toBe('hello world');
    });

    it('falls back when wordTimestamps is an empty array (present but empty)', () => {
      const segments = [{ startMs: 1000, endMs: 3000, text: 'hello world', wordTimestamps: [] }];
      const cues = buildCaptionCues(segments, { startMs: 1000, endMs: 3000 });
      expect(cues).toHaveLength(1);
      expect(cues[0].lines.join(' ')).toBe('hello world');
    });
  });

  describe('buildWordLevelCues directly', () => {
    it('drops a group that becomes empty after range clipping rather than emitting a zero-duration cue', () => {
      const wordsList = [{ word: 'outside', startMs: 0, endMs: 100 }, { word: 'inside', startMs: 500, endMs: 900 }];
      const cues = buildWordLevelCues(wordsList, { startMs: 400, endMs: 1000, maxWordsPerCue: 2, style: { maxCharsPerLine: 30, maxLines: 2 } });
      expect(cues).toHaveLength(1);
      expect(cues[0].lines.join(' ')).toBe('inside');
    });
  });

  describe('cuesToSrt', () => {
    it('produces valid, sequentially-numbered SRT output', () => {
      const cues = [
        { startMs: 0, endMs: 1000, lines: ['hello'] },
        { startMs: 1000, endMs: 2000, lines: ['world'] },
      ];
      const srt = cuesToSrt(cues);
      expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,000\nhello');
      expect(srt).toContain('2\n00:00:01,000 --> 00:00:02,000\nworld');
    });

    it('returns an empty string for no cues', () => {
      expect(cuesToSrt([])).toBe('');
    });
  });
});
