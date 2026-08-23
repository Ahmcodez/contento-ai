const config = require('../config');
const { TranscriptionProviderError } = require('./TranscriptionProvider');
const WhisperLocalProvider = require('./WhisperLocalProvider');

class NotConfiguredTranscriptionProvider {
  /* eslint-disable class-methods-use-this */
  async transcribe() {
    throw new TranscriptionProviderError(
      'No transcription provider is configured. Set TRANSCRIPTION_PROVIDER=whisper-local (and install the whisper CLI) to enable transcription.',
      { retryable: false, reason: 'not_configured' },
    );
  }
  /* eslint-enable class-methods-use-this */
}

let instance;

function getTranscriptionProvider() {
  if (instance) return instance;

  if (config.transcription.provider === 'whisper-local') {
    instance = new WhisperLocalProvider();
  } else {
    instance = new NotConfiguredTranscriptionProvider();
  }
  return instance;
}

module.exports = { getTranscriptionProvider, NotConfiguredTranscriptionProvider };
