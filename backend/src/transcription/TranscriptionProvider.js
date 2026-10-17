/**
 * TranscriptionProvider — abstraction over speech-to-text. Kept separate
 * from AIProvider since transcription and text-generation are different
 * capabilities with different providers/cost profiles (docs/AI.md,
 * docs/ARCHITECTURE.md §2.10).
 */
class TranscriptionProvider {
  /* eslint-disable no-unused-vars */
  async transcribe(audioFilePath) {
    throw new Error('TranscriptionProvider.transcribe not implemented');
  }
  /* eslint-enable no-unused-vars */
}

class TranscriptionProviderError extends Error {
  constructor(message, { retryable = true, reason = 'unknown' } = {}) {
    super(message);
    this.name = 'TranscriptionProviderError';
    this.retryable = retryable;
    this.reason = reason;
  }
}

module.exports = { TranscriptionProvider, TranscriptionProviderError };
