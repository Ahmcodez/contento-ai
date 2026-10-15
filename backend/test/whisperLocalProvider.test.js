jest.mock('child_process');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const WhisperLocalProvider = require('../src/transcription/WhisperLocalProvider');

describe('WhisperLocalProvider', () => {
  let audioPath;

  beforeEach(() => {
    audioPath = path.join(os.tmpdir(), `whisper-test-${Date.now()}.wav`);
    execFile.mockReset();
  });

  afterEach(async () => {
    await fs.unlink(audioPath.replace(path.extname(audioPath), '.json')).catch(() => {});
  });

  async function mockWhisperRun(whisperJson) {
    execFile.mockImplementation((bin, args, opts, cb) => {
      const outDir = args[args.indexOf('--output_dir') + 1];
      const jsonPath = path.join(outDir, `${path.basename(audioPath, path.extname(audioPath))}.json`);
      fs.writeFile(jsonPath, JSON.stringify(whisperJson)).then(() => cb(null, '', ''));
    });
  }

  it('passes --word_timestamps True to the whisper CLI', async () => {
    let seenArgs;
    execFile.mockImplementation((bin, args, opts, cb) => {
      seenArgs = args;
      const outDir = args[args.indexOf('--output_dir') + 1];
      fs.writeFile(path.join(outDir, `${path.basename(audioPath, '.wav')}.json`), JSON.stringify({ text: 'x', segments: [] })).then(() => cb(null, '', ''));
    });
    await new WhisperLocalProvider().transcribe(audioPath);
    expect(seenArgs).toEqual(expect.arrayContaining(['--word_timestamps', 'True']));
  });

  it('maps nested per-segment word timestamps into the normalized words field', async () => {
    await mockWhisperRun({
      text: 'Hello world.',
      language: 'en',
      segments: [
        {
          start: 0,
          end: 1.5,
          text: ' Hello world.',
          words: [
            { word: ' Hello', start: 0.0, end: 0.5, probability: 0.9 },
            { word: ' world.', start: 0.6, end: 1.4, probability: 0.95 },
          ],
        },
      ],
    });

    const result = await new WhisperLocalProvider().transcribe(audioPath);

    expect(result.segments[0].words).toEqual([
      { word: ' Hello', startMs: 0, endMs: 500 },
      { word: ' world.', startMs: 600, endMs: 1400 },
    ]);
  });

  it('flows through normalizeTranscript into wordTimestamps', async () => {
    await mockWhisperRun({
      text: 'Hi.',
      segments: [{ start: 0, end: 1, text: ' Hi.', words: [{ word: ' Hi.', start: 0, end: 0.5 }] }],
    });
    const result = await new WhisperLocalProvider().transcribe(audioPath);
    const { normalizeTranscript } = require('../src/transcript/normalize');
    const normalized = normalizeTranscript(result);
    expect(normalized.segments[0].wordTimestamps).toEqual([{ word: ' Hi.', startMs: 0, endMs: 500 }]);
  });

  it('produces an empty words array for a segment with no words key (no crash)', async () => {
    await mockWhisperRun({ text: 'Hi.', segments: [{ start: 0, end: 1, text: ' Hi.' }] }); // no `words`
    const result = await new WhisperLocalProvider().transcribe(audioPath);
    expect(result.segments[0].words).toEqual([]);
  });
});
