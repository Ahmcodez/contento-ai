const { wrapCaptionText, buildCaptionCues, cuesToSrt, msToSrtTimestamp } = require('../src/media/CaptionGenerator');

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
