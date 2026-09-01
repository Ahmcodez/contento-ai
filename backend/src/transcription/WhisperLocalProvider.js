const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { TranscriptionProvider, TranscriptionProviderError } = require('./TranscriptionProvider');

const WHISPER_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Shells out to a local `whisper` CLI (openai-whisper or whisper.cpp,
 * whichever is on PATH) to transcribe audio with zero per-call API cost
 * (docs/COST.md §1). This is a real integration, not a stub — but it
 * genuinely requires the binary to be installed, which this sandbox does
 * not have. If the binary is missing, it fails with a clear,
 * non-retryable "not configured" error rather than returning fake text.
 */
class WhisperLocalProvider extends TranscriptionProvider {
  constructor({ binaryName = 'whisper', outputFormat = 'json' } = {}) {
    super();
    this.binaryName = binaryName;
    this.outputFormat = outputFormat;
  }

  async transcribe(audioFilePath) {
    const outDir = path.dirname(audioFilePath);

    try {
      await new Promise((resolve, reject) => {
        execFile(
          this.binaryName,
          [audioFilePath, '--output_format', this.outputFormat, '--output_dir', outDir],
          { timeout: WHISPER_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
          (err, out, errOut) => {
            if (err) {
              const notFound = err.code === 'ENOENT';
              return reject(
                new TranscriptionProviderError(
                  notFound
                    ? `Local Whisper binary "${this.binaryName}" is not installed. Install it or configure a hosted transcription provider.`
                    : `Whisper transcription failed: ${err.message}`,
                  { retryable: !notFound, reason: notFound ? 'not_configured' : 'provider_error' },
                ),
              );
            }
            return resolve({ stdout: out, stderr: errOut });
          },
        );
      });
    } catch (err) {
      if (err instanceof TranscriptionProviderError) throw err;
      throw new TranscriptionProviderError(`Unexpected transcription error: ${err.message}`, { retryable: true });
    }

    const jsonPath = audioFilePath.replace(path.extname(audioFilePath), '.json');
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    } catch {
      throw new TranscriptionProviderError('Whisper produced no readable output', { retryable: true });
    }

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

module.exports = WhisperLocalProvider;
