jest.mock('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ytdlpRunner = require('../src/providers/YtDlpRunner');
const { ProviderError } = require('../src/providers/URLProvider');
const config = require('../src/config');
const { _resetCacheForTests } = require('../src/providers/resolveFfmpegLocation');

// downloadTo now resolves config.ffmpeg.ffmpegPath to an absolute path
// before invoking yt-dlp (see resolveFfmpegLocation.js — yt-dlp's
// --ffmpeg-location does a literal file-existence check, not a PATH
// search, unlike this app's own direct ffmpeg calls). Pointing the config
// at this test file's own (real, always-existing) absolute path makes
// that resolution a no-op short-circuit, so it costs no extra mocked
// execFile call in every test below, exactly as before this feature existed.
const originalFfmpegPath = config.ffmpeg.ffmpegPath;
beforeAll(() => {
  config.ffmpeg.ffmpegPath = __filename;
});
afterAll(() => {
  config.ffmpeg.ffmpegPath = originalFfmpegPath;
  _resetCacheForTests();
});

function mockExecFileOnce(impl) {
  execFile.mockImplementationOnce((bin, args, opts, cb) => impl(bin, args, opts, cb));
}

// downloadTo now verifies each candidate with MediaProcessor.probe(),
// which itself calls execFile for ffprobe — a second, separate mocked
// call from the yt-dlp invocation itself. Matches probe()'s actual
// expected ffprobe JSON shape (src/media/MediaProcessor.js).
function mockProbeOnce({ hasAudio }) {
  mockExecFileOnce((bin, args, opts, cb) => cb(
    null,
    JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
        ...(hasAudio ? [{ codec_type: 'audio', codec_name: 'aac' }] : []),
      ],
      format: { duration: '10.5' },
    }),
    '',
  ));
}

describe('YtDlpRunner', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getMetadataJson', () => {
    it('invokes yt-dlp with -J, --no-playlist, and --skip-download (never actually downloads for a metadata call)', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, JSON.stringify({ id: 'abc123', title: 'Test Video', duration: 42.5, thumbnail: 'https://example.com/t.jpg', width: 1920, height: 1080 }), ''));

      const info = await ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc123');

      expect(info.id).toBe('abc123');
      const [, args] = execFile.mock.calls[0];
      expect(args).toContain('-J');
      expect(args).toContain('--no-playlist');
      expect(args).toContain('--skip-download');
      expect(args).toContain('https://youtube.com/watch?v=abc123');
    });

    it('passes the URL as a single array element, never interpolated into a shell string', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '{}', ''));
      const maliciousUrl = 'https://youtube.com/watch?v=abc; rm -rf /tmp/x';
      await ytdlpRunner.getMetadataJson(maliciousUrl);
      const [bin, args] = execFile.mock.calls[0];
      expect(bin).toBe('yt-dlp');
      // The full malicious string must appear as exactly one array
      // element (execFile never invokes a shell to interpret it), not
      // split apart or otherwise processed.
      expect(args.filter((a) => a === maliciousUrl)).toHaveLength(1);
    });

    it('throws a retryable ProviderError when yt-dlp returns unparseable output', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, 'not json', ''));
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: true,
      });
    });
  });

  describe('downloadTo', () => {
    it('passes --max-filesize when maxBytes is given, --ffmpeg-location for muxing, and --print after_move:filepath', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-args-'));
      const dest = path.join(dir, 'out.mp4');
      fs.writeFileSync(dest, 'video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, ''));
      mockProbeOnce({ hasAudio: true });
      await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, { maxBytes: 500000000 });
      const [, args] = execFile.mock.calls[0];
      expect(args).toContain('--max-filesize');
      expect(args).toContain('500000000');
      expect(args).toContain('--ffmpeg-location');
      expect(args).toContain('-o');
      expect(args).toContain(dest);
      expect(args).toContain('--print');
      expect(args).toContain('after_move:filepath');
      expect(args).toContain('--quiet');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does NOT pass --no-warnings, unlike getMetadataJson — suppressing it hid a real ffmpeg-merge warning in production', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-nowarn-'));
      const dest = path.join(dir, 'out.mp4');
      fs.writeFileSync(dest, 'video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, ''));
      mockProbeOnce({ hasAudio: true });
      await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});
      const [, args] = execFile.mock.calls[0];
      expect(args).not.toContain('--no-warnings');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('omits --max-filesize when no maxBytes is given', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-nomax-'));
      const dest = path.join(dir, 'out.mp4');
      fs.writeFileSync(dest, 'video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, ''));
      mockProbeOnce({ hasAudio: true });
      await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});
      const [, args] = execFile.mock.calls[0];
      expect(args).not.toContain('--max-filesize');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns the requested path when it exists and has both audio and video', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-ok-'));
      const dest = path.join(dir, 'out.mp4');
      fs.writeFileSync(dest, 'video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, ''));
      mockProbeOnce({ hasAudio: true });
      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});
      expect(result.filePath).toBe(dest);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns yt-dlp\'s actual final path when post-processing moved the file somewhere other than the requested -o value', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-moved-'));
      const dest = path.join(dir, 'out.mp4');
      const actual = path.join(dir, 'out.fXXX.mp4');
      fs.writeFileSync(actual, 'video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${actual}\n`, ''));
      mockProbeOnce({ hasAudio: true });
      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});
      expect(result.filePath).toBe(actual);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('recovers by scanning the output directory when the reported path does not exist on disk (the real-world failure)', async () => {
      // The diagnosed production bug: yt-dlp exits 0, but neither the
      // requested path nor the path it reported actually exists — the
      // real file is there under a different name.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-scan-'));
      const dest = path.join(dir, 'import-abc123.mp4');
      const real = path.join(dir, 'import-abc123.f137.mp4');
      fs.writeFileSync(real, 'the actual video bytes');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${path.join(dir, 'bogus.mp4')}\n`, ''));
      mockProbeOnce({ hasAudio: true });

      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});

      expect(result.filePath).toBe(real);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rejects a recovered file that has video but no audio, and tries the next candidate instead of accepting it', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-noaudio-'));
      const dest = path.join(dir, 'import-abc.mp4');
      const videoOnlyFragment = path.join(dir, 'import-abc.f137.mp4');
      const realMerged = path.join(dir, 'import-abc.f-merged.mp4');
      // Fragment written first/smaller, real merged file larger — larger
      // sorts first, so this also confirms audio verification (not just
      // size ordering) is what actually decides the winner here: put the
      // no-audio file first in size order to prove it gets skipped.
      fs.writeFileSync(videoOnlyFragment, 'x'.repeat(200));
      fs.writeFileSync(realMerged, 'y'.repeat(100));
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '\n', ''));
      mockProbeOnce({ hasAudio: false }); // the larger, video-only fragment, checked first
      mockProbeOnce({ hasAudio: true }); // the smaller, actually-merged file

      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});

      expect(result.filePath).toBe(realMerged);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fails with a specific merge_failed error when every candidate has video but no audio (the diagnosed real-world bug)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-mergefail-'));
      const dest = path.join(dir, 'import-abc.mp4');
      fs.writeFileSync(dest, 'video-only output');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, ''));
      mockProbeOnce({ hasAudio: false });

      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {})).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: false,
        reason: 'merge_failed',
        message: expect.stringContaining('audio track could not be merged'),
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('logs the real yt-dlp stderr on a merge failure, so the actual cause (e.g. an ffmpeg warning) is visible without guessing', async () => {
      const logger = require('../src/logger');
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-mergefail-log-'));
      const dest = path.join(dir, 'import-abc.mp4');
      fs.writeFileSync(dest, 'video-only output');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, `${dest}\n`, 'WARNING: ffmpeg not found; the download will not be merged'));
      mockProbeOnce({ hasAudio: false });

      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {})).rejects.toMatchObject({ reason: 'merge_failed' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ stderr: expect.stringContaining('ffmpeg not found') }),
        expect.stringContaining('merge did not complete'),
      );
      errorSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('excludes audio-only fragments (.m4a) from directory-scan candidates entirely', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-m4a-'));
      const dest = path.join(dir, 'import-abc.mp4');
      const realMerged = path.join(dir, 'import-abc.merged.mp4');
      fs.writeFileSync(path.join(dir, 'import-abc.f140.m4a'), 'z'.repeat(500)); // larger than the real file, but wrong extension
      fs.writeFileSync(realMerged, 'the real video');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '\n', ''));
      mockProbeOnce({ hasAudio: true });

      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {});
      expect(result.filePath).toBe(realMerged);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('ignores .part files when scanning, so an interrupted download is never mistaken for the result', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-part-'));
      const dest = path.join(dir, 'import-abc.mp4');
      fs.writeFileSync(path.join(dir, 'import-abc.mp4.part'), 'partial');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '\n', ''));

      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {})).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'extraction_failed',
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not pick up a concurrent import\'s file when scanning', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-concurrent-'));
      const dest = path.join(dir, 'import-mine.mp4');
      fs.writeFileSync(path.join(dir, 'import-someone-else.mp4'), 'not mine');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '\n', ''));

      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {})).rejects.toMatchObject({
        name: 'ProviderError',
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('throws a retryable ProviderError when no output file can be found at all', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-none-'));
      const dest = path.join(dir, 'out.mp4');
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '', ''));
      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', dest, {})).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: true,
        reason: 'extraction_failed',
      });
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('error classification (stderr pattern matching)', () => {
    it.each([
      ['ERROR: [youtube] abc123: Private video. Sign in if you\'ve been granted access.', 'private_video'],
      ['ERROR: [youtube] abc123: Video unavailable', 'unavailable'],
      ['ERROR: Sign in to confirm your age', 'authentication_required'],
      ['ERROR: This video is only available to Music Premium members', 'authentication_required'],
      ['ERROR: The uploader has not made this video available in your country', 'geo_restricted'],
      ['ERROR: Unsupported URL: https://example.com/x', 'unsupported_provider'],
      ['ERROR: File is larger than max-filesize (500000000 bytes)', 'too_large'],
    ])('classifies %s as reason=%s, non-retryable', async (stderr, expectedReason) => {
      mockExecFileOnce((bin, args, opts, cb) => cb(new Error('Command failed'), '', stderr));
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({
        name: 'ProviderError',
        reason: expectedReason,
        retryable: false,
      });
    });

    it('treats an unrecognized failure as retryable rather than assuming it is permanent', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(new Error('Command failed'), '', 'ERROR: some completely novel yt-dlp failure mode'));
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'extraction_failed',
        retryable: true,
      });
    });

    it('logs the raw stderr server-side on an unrecognized failure, so it is diagnosable without reproducing by hand', async () => {
      const logger = require('../src/logger');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      mockExecFileOnce((bin, args, opts, cb) => cb(new Error('Command failed'), '', 'ERROR: Postprocessing: ffprobe and ffmpeg not found'));

      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({ reason: 'extraction_failed' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ stderr: expect.stringContaining('ffprobe and ffmpeg not found') }),
        expect.stringContaining('unrecognized stderr'),
      );
      warnSpy.mockRestore();
    });

    it('classifies a missing yt-dlp binary (ENOENT) as non-retryable and actionable', async () => {
      const err = new Error('spawn yt-dlp ENOENT');
      err.code = 'ENOENT';
      mockExecFileOnce((bin, args, opts, cb) => cb(err, '', ''));
      mockExecFileOnce((bin, args, opts, cb) => cb(err, '', ''));
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'not_configured',
        retryable: false,
      });
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toThrow(/not installed or not on PATH/);
    });

    it('classifies a killed/timed-out process as retryable', async () => {
      const err = new Error('Command timed out');
      err.killed = true;
      mockExecFileOnce((bin, args, opts, cb) => cb(err, '', ''));
      await expect(ytdlpRunner.getMetadataJson('https://youtube.com/watch?v=abc')).rejects.toMatchObject({
        name: 'ProviderError',
        reason: 'timeout',
        retryable: true,
      });
    });
  });

  it('classifyStderr is exported and usable directly for ad-hoc error mapping', () => {
    const err = ytdlpRunner.classifyStderr('ERROR: Private video');
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.reason).toBe('private_video');
  });
});
