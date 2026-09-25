const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');
const mediaProcessor = require('../media/MediaProcessor');
const { TranscriptionProvider, TranscriptionProviderError } = require('./TranscriptionProvider');

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Hosted transcription via Groq's Whisper endpoint (OpenAI-compatible
 * request/response shape). Unlike WhisperLocalProvider, this needs no
 * binary installed on the machine running the worker — just an API key
 * (docs/AI.md §"why Groq"): cheapest available transcription ($0.04/hr)
 * with a real, renewing daily free tier for development, not a one-time
 * trial credit.
 *
 * Scalability note: MAX_VIDEO_DURATION_SECONDS allows up to an hour of
 * source video. extractAudio's raw 16-bit PCM WAV output for a full hour
 * is ~115MB — over Groq's 25MB free-tier limit and close to its 100MB
 * paid-tier limit. Rather than silently failing (or worse, silently
 * truncating) on long videos, this compresses to Opus first whenever the
 * source file is over the configured threshold (24MB by default), which
 * gets a full hour down to ~19MB — verified against a real 10-minute WAV
 * in this repo's own test suite. The temp compressed file is always
 * cleaned up, success or failure.
 */
class GroqTranscriptionProvider extends TranscriptionProvider {
  constructor({ apiKey = config.transcription.groqApiKey, model = config.transcription.groqModel } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  async transcribe(audioFilePath) {
    if (!this.apiKey) {
      throw new TranscriptionProviderError(
        'Groq transcription is not configured. Set GROQ_API_KEY (get a free key at https://console.groq.com/keys).',
        { retryable: false, reason: 'not_configured' },
      );
    }

    const { path: uploadPath, cleanup } = await this.#prepareUploadFile(audioFilePath);
    try {
      const raw = await this.#callGroq(uploadPath);
      return this.#normalize(raw);
    } finally {
      await cleanup();
    }
  }

  /**
   * Returns the file to actually upload, compressing to Opus first if the
   * original is over the configured size ceiling. Always returns a
   * cleanup function — a no-op when no temp file was created — so callers
   * never have to know which case they're in.
   */
  async #prepareUploadFile(audioFilePath) {
    const { size } = await fs.stat(audioFilePath);
    if (size <= config.transcription.groqMaxUploadBytes) {
      return { path: audioFilePath, cleanup: async () => {} };
    }

    const compressedPath = path.join(os.tmpdir(), `groq-upload-${crypto.randomUUID()}.opus`);
    logger.info(
      { audioFilePath, sizeBytes: size, maxBytes: config.transcription.groqMaxUploadBytes },
      'audio exceeds Groq upload limit, compressing before upload',
    );
    await mediaProcessor.compressAudioForUpload(audioFilePath, compressedPath);
    return {
      path: compressedPath,
      cleanup: async () => {
        await fs.unlink(compressedPath).catch(() => {});
      },
    };
  }

  async #callGroq(uploadPath) {
    const buffer = await fs.readFile(uploadPath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(uploadPath));
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.transcription.groqTimeoutMs);

    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new TranscriptionProviderError('Groq transcription request timed out.', { retryable: true, reason: 'timeout' });
      }
      throw new TranscriptionProviderError(`Could not reach Groq: ${err.message}`, { retryable: true, reason: 'network_error' });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await this.#classifyError(response);
    }
    return response.json();
  }

  async #classifyError(response) {
    const bodyText = await response.text().catch(() => '');
    // Full response logged server-side for diagnosability; never surfaced
    // to a client — mirrors the pattern in GeminiProvider.js and
    // YtDlpRunner.js's handling of unrecognized subprocess failures.
    logger.warn({ status: response.status, body: bodyText.slice(0, 2000) }, 'Groq transcription request failed');

    if (response.status === 401 || response.status === 403) {
      return new TranscriptionProviderError('Groq rejected the API key. Check GROQ_API_KEY.', {
        retryable: false,
        reason: 'authentication_failed',
      });
    }
    if (response.status === 429) {
      // Groq's free tier is rate- and quota-limited (RPM/RPD/ASH/ASD, not
      // just RPM), so a 429 here can mean "try again in a second" or
      // "you're out of daily quota until it resets" — both are transient
      // from this app's perspective, so both are retryable; BullMQ's
      // backoff (see RETRY_CONFIG) is what actually paces the retry.
      return new TranscriptionProviderError('Groq rate limit or daily quota reached.', { retryable: true, reason: 'rate_limited' });
    }
    if (response.status === 413) {
      return new TranscriptionProviderError(
        'Audio file was too large for Groq even after compression. Lower GROQ_MAX_UPLOAD_MB or check the source video length.',
        { retryable: false, reason: 'file_too_large' },
      );
    }
    if (response.status >= 500) {
      return new TranscriptionProviderError('Groq had a server error.', { retryable: true, reason: 'provider_error' });
    }
    return new TranscriptionProviderError(`Groq transcription failed (HTTP ${response.status}).`, {
      retryable: false,
      reason: 'provider_error',
    });
  }

  #normalize(raw) {
    const segments = (raw.segments || []).map((s, i) => ({
      sequence: i,
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));
    return {
      fullText: raw.text?.trim() || segments.map((s) => s.text).join(' '),
      language: raw.language || null,
      segments,
      raw,
    };
  }
}

module.exports = GroqTranscriptionProvider;
