const AppError = require('../utils/AppError');

/**
 * Splits a normalized transcript into chunks bounded by
 * maxCharsPerChunk, breaking on segment boundaries (never mid-sentence)
 * so each chunk stays coherent for the LLM. Enforces maxChunks as a hard
 * cost ceiling — a video whose transcript would need more chunks than
 * that is rejected rather than silently making unlimited AI calls
 * (docs/COST.md).
 */
function chunkTranscript(segments, { maxCharsPerChunk, maxChunks }) {
  if (segments.length === 0) return [];

  const chunks = [];
  let current = { segments: [], text: '', startMs: segments[0].startMs, endMs: segments[0].startMs };

  for (const segment of segments) {
    const nextLength = current.text.length + segment.text.length + 1;

    if (current.segments.length > 0 && nextLength > maxCharsPerChunk) {
      chunks.push(finalizeChunk(current));
      current = { segments: [], text: '', startMs: segment.startMs, endMs: segment.startMs };
    }

    current.segments.push(segment);
    current.text = current.text.length > 0 ? `${current.text} ${segment.text}` : segment.text;
    current.endMs = segment.endMs;
  }

  if (current.segments.length > 0) {
    chunks.push(finalizeChunk(current));
  }

  if (chunks.length > maxChunks) {
    throw AppError.badRequest(
      `This video's transcript is too long to process (would require ${chunks.length} AI calls, limit is ${maxChunks}). Try a shorter video.`,
      'TRANSCRIPT_TOO_LONG',
    );
  }

  return chunks;
}

function finalizeChunk(chunk) {
  return { text: chunk.text, startMs: chunk.startMs, endMs: chunk.endMs, segmentCount: chunk.segments.length };
}

module.exports = { chunkTranscript };
