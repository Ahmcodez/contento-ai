const AppError = require('../utils/AppError');

/**
 * A transcript the model can reason about *positionally*.
 *
 * Why this exists: the AI used to be handed the transcript as one block of plain
 * text and asked for startMs/endMs. It had no timestamps to read them from, so
 * every boundary was a guess, and clips did not reliably start at the hook or end
 * where the explanation does. Here every line carries a numeric id, the model
 * answers in line ids ("the hook is line 412, the explanation ends at line 431"),
 * and code maps ids back to the exact timestamps from the transcript. Ids are
 * short (about two tokens per line), so this adds far less than it replaces.
 *
 * Lines, not raw segments: speech-to-text emits many tiny segments, and each one
 * would cost an id. Short neighbours are merged into one line, which also gives the
 * model fuller sentences to judge.
 */

const MIN_LINE_CHARS = 60;
const MAX_LINE_CHARS = 260;
const SENTENCE_END = /[.!?]["')\]]?$/;

/** segments: [{ startMs, endMs, text, wordTimestamps? }] -> [{ id, startMs, endMs, text, words }] */
function buildTimedLines(segments) {
  const lines = [];
  let current = null;

  const close = () => {
    if (current) lines.push({ ...current, id: lines.length });
    current = null;
  };

  for (const segment of segments) {
    const text = String(segment.text || '').trim();
    if (!text) continue;

    if (current && current.text.length + 1 + text.length > MAX_LINE_CHARS) close();

    if (!current) {
      current = { startMs: segment.startMs, endMs: segment.endMs, text, words: [...(segment.wordTimestamps || [])] };
    } else {
      current.text = `${current.text} ${text}`;
      current.endMs = segment.endMs;
      current.words.push(...(segment.wordTimestamps || []));
    }

    const long = current.text.length >= MIN_LINE_CHARS;
    const sentenceDone = SENTENCE_END.test(current.text) && current.text.length >= MIN_LINE_CHARS / 2;
    if (long || sentenceDone) close();
  }
  close();

  return lines;
}

const formatLine = (line) => `[${line.id}] ${line.text}`;

/** The prompt form: one "[id] text" per line. */
function formatTimedLines(lines) {
  return lines.map(formatLine).join('\n');
}

/**
 * Splits lines into chunks no bigger than maxCharsPerChunk (measured on the
 * formatted text, since that is what is sent). Line ids stay global, so a model
 * reading chunk 3 still answers in ids that mean something for the whole video.
 */
function chunkTimedLines(lines, { maxCharsPerChunk, maxChunks }) {
  if (lines.length === 0) return [];

  const chunks = [];
  let current = [];
  let size = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      lines: current,
      text: formatTimedLines(current),
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
    });
    current = [];
    size = 0;
  };

  for (const line of lines) {
    const length = formatLine(line).length + 1;
    if (current.length > 0 && size + length > maxCharsPerChunk) flush();
    current.push(line);
    size += length;
  }
  flush();

  if (chunks.length > maxChunks) {
    throw AppError.badRequest(
      `This video's transcript is too long to process (would require ${chunks.length} AI calls, limit is ${maxChunks}). Try a shorter video.`,
      'TRANSCRIPT_TOO_LONG',
    );
  }
  return chunks;
}

/**
 * Turns a model-supplied pair of line ids into a validated, ordered span of real
 * lines, or null if the ids don't point at anything. Tolerates the usual model
 * slips: reversed ids, a missing end id (a single line), ids as numeric strings,
 * and ids a little out of range (clamped).
 */
function resolveLineSpan(lines, startLine, endLine) {
  if (lines.length === 0) return null;
  const toInt = (v) => (v === undefined || v === null || v === '' ? NaN : Math.trunc(Number(v)));

  let a = toInt(startLine);
  let b = toInt(endLine);
  if (!Number.isFinite(a)) return null;
  if (!Number.isFinite(b)) b = a;
  if (a > b) [a, b] = [b, a];

  const last = lines.length - 1;
  if (b < 0 || a > last) return null;
  a = Math.max(0, a);
  b = Math.min(last, b);

  return { startLine: a, endLine: b, lines: lines.slice(a, b + 1) };
}

/** Lowercase, strip punctuation: lets "Most people get this backwards." match "most people get this backwards". */
function normalizeToken(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, '');
}

/**
 * Finds where a hook phrase is actually spoken, so a clip can start on its first
 * word rather than at the start of the line it sits in. Searches the word
 * timestamps of the given lines for the first few words of the phrase and returns
 * that word's startMs, or null if not found (no word timing, or the model
 * paraphrased instead of quoting).
 */
function locatePhraseStartMs(lines, phrase, { matchWords = 3 } = {}) {
  const target = String(phrase || '')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .slice(0, matchWords);
  if (target.length === 0) return null;

  const words = lines.flatMap((l) => l.words || []);
  for (let i = 0; i + target.length <= words.length; i += 1) {
    let all = true;
    for (let j = 0; j < target.length; j += 1) {
      if (normalizeToken(words[i + j].word) !== target[j]) {
        all = false;
        break;
      }
    }
    if (all) return words[i].startMs;
  }
  return null;
}

module.exports = { buildTimedLines, formatTimedLines, chunkTimedLines, resolveLineSpan, locatePhraseStartMs, normalizeToken };
