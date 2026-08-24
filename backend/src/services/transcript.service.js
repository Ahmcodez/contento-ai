const transcriptRepository = require('../repositories/transcript.repository');
const { normalizeTranscript } = require('../transcript/normalize');

async function persistTranscript({ mediaAssetId, rawResult, provider }) {
  const normalized = normalizeTranscript(rawResult);
  const transcript = await transcriptRepository.create({
    mediaAssetId,
    fullText: normalized.fullText,
    language: normalized.language,
    provider,
    rawProviderResponse: rawResult.raw || null,
    segments: normalized.segments,
  });
  return { transcript, normalized };
}

async function getNormalizedTranscript(mediaAssetId) {
  const transcript = await transcriptRepository.findByMediaAssetId(mediaAssetId);
  if (!transcript) return null;
  const segments = await transcriptRepository.findSegments(transcript.id);
  return {
    id: transcript.id,
    fullText: transcript.full_text,
    language: transcript.language,
    segments: segments.map((s) => ({
      sequence: s.sequence,
      startMs: s.start_ms,
      endMs: s.end_ms,
      text: s.text,
      speakerLabel: s.speaker_label,
      wordTimestamps: s.word_timestamps,
    })),
  };
}

module.exports = { persistTranscript, getNormalizedTranscript };
