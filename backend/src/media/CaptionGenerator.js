const config = require('../config');

function msToSrtTimestamp(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * Wraps text to at most `maxLines` lines of at most `maxCharsPerLine`
 * characters each, breaking on word boundaries. If the text is too long
 * to fit, the last line is not truncated mid-word — it's allowed to run
 * slightly over rather than cut a word in half, since a readable-but-
 * slightly-long caption beats a mangled one.
 */
function wrapCaptionText(text, { maxCharsPerLine, maxLines }) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current.length > 0 ? `${current} ${word}` : word;

    if (candidate.length > maxCharsPerLine && current.length > 0) {
      lines.push(current);
      if (lines.length === maxLines - 1) {
        // Last allowed line — let it absorb every remaining word rather
        // than silently dropping them or cutting mid-word.
        current = words.slice(i).join(' ');
        break;
      }
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines.slice(0, maxLines);
}

/**
 * Groups a flat list of words (already clipped to the segments overlapping
 * [startMs, endMs)) into short, precisely-timed cues of up to
 * `maxWordsPerCue` words each — the standard short-form caption style
 * (a few words flashed at a time), rather than a whole sentence sitting
 * on screen for several seconds. Each cue's timing comes from the real
 * start of its first word and the real end of its last word, clipped to
 * the clip's own boundaries and re-based to 0 = clip start.
 */
function buildWordLevelCues(words, { startMs, endMs, maxWordsPerCue, style }) {
  const inRange = words.filter((w) => w.startMs < endMs && w.endMs > startMs);
  const cues = [];
  for (let i = 0; i < inRange.length; i += maxWordsPerCue) {
    const group = inRange.slice(i, i + maxWordsPerCue);
    const cueStartMs = Math.max(group[0].startMs, startMs) - startMs;
    const cueEndMs = Math.min(group[group.length - 1].endMs, endMs) - startMs;
    if (cueEndMs <= cueStartMs) continue; // fully clipped away by the clip boundary
    const text = group.map((w) => w.word).join(' ').trim();
    if (text.length === 0) continue;
    cues.push({ startMs: cueStartMs, endMs: cueEndMs, lines: wrapCaptionText(text, style) });
  }
  return cues;
}

/**
 * Builds caption "cues" (grouped, time-bounded, wrapped text blocks) from
 * transcript segments clipped to [startMs, endMs) and re-based to
 * 0 = clip start (since the rendered clip is its own timeline).
 *
 * When the transcript has word-level timestamps (Groq and
 * WhisperLocalProvider both request these now — a real gap fixed after
 * launch, since whole-sentence captions sitting on screen for 5+ seconds
 * is not how any actual short-form video captions its content), words
 * from every overlapping segment are pooled and regrouped into short
 * chunks via buildWordLevelCues — not kept as one cue per segment, so a
 * clip spanning a segment boundary still gets evenly-sized caption chunks
 * rather than one oddly-short trailing cue per segment.
 *
 * Without word-level data (older transcripts, or a provider that doesn't
 * supply it), this falls back to the original behavior unchanged: one cue
 * per transcript segment.
 */
function buildCaptionCues(segments, { startMs, endMs, style = config.captions } = {}) {
  const relevant = segments.filter((s) => s.startMs < endMs && s.endMs > startMs);
  const allWords = relevant.flatMap((s) => s.wordTimestamps || []);

  if (allWords.length > 0) {
    const maxWordsPerCue = style.maxWordsPerCue || config.captions.maxWordsPerCue;
    return buildWordLevelCues(allWords, { startMs, endMs, maxWordsPerCue, style });
  }

  return relevant
    .map((s) => {
      const cueStartMs = Math.max(s.startMs, startMs) - startMs;
      const cueEndMs = Math.min(s.endMs, endMs) - startMs;
      return {
        startMs: cueStartMs,
        endMs: cueEndMs,
        lines: wrapCaptionText(s.text, style),
      };
    })
    .filter((cue) => cue.endMs > cue.startMs && cue.lines.length > 0);
}

/**
 * Renders cues to SRT format — the format FFmpeg's `subtitles` filter
 * consumes directly (MediaProcessor.renderVerticalClip).
 */
function cuesToSrt(cues) {
  return cues
    .map((cue, i) => {
      const index = i + 1;
      const timing = `${msToSrtTimestamp(cue.startMs)} --> ${msToSrtTimestamp(cue.endMs)}`;
      const text = cue.lines.join('\n');
      return `${index}\n${timing}\n${text}\n`;
    })
    .join('\n');
}

/**
 * Style presets — the caption *content/timing* system above is
 * style-independent; this is the seam for later supporting multiple
 * visual styles (e.g. "bold center", "karaoke highlight") without
 * touching cue generation. Only 'default' is implemented; FFmpeg's
 * `subtitles` filter honors `force_style` overrides derived from this.
 */
const CAPTION_STYLES = {
  default: (style = config.captions) => ({
    fontName: style.font,
    fontSize: style.fontSize,
    marginVPercent: style.safeMarginPercent,
  }),
};

module.exports = { wrapCaptionText, buildCaptionCues, buildWordLevelCues, cuesToSrt, msToSrtTimestamp, CAPTION_STYLES };
