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
 * Builds caption "cues" (grouped, time-bounded, wrapped text blocks) from
 * transcript segments clipped to [startMs, endMs) and re-based to
 * 0 = clip start (since the rendered clip is its own timeline). Segments
 * longer than a readable caption duration are not split further in this
 * milestone — each transcript segment becomes one cue, which keeps
 * synchronization simple and correct; finer-grained re-timing within a
 * segment is a documented future improvement, not built here.
 */
function buildCaptionCues(segments, { startMs, endMs, style = config.captions } = {}) {
  return segments
    .filter((s) => s.startMs < endMs && s.endMs > startMs)
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

module.exports = { wrapCaptionText, buildCaptionCues, cuesToSrt, msToSrtTimestamp, CAPTION_STYLES };
