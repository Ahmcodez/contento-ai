jest.mock('child_process');
const { execFile } = require('child_process');
const ytdlpRunner = require('../src/providers/YtDlpRunner');
const { ProviderError } = require('../src/providers/URLProvider');

function mockExecFileOnce(impl) {
  execFile.mockImplementationOnce((bin, args, opts, cb) => impl(bin, args, opts, cb));
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
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '/tmp/out.mp4\n', ''));
      await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', { maxBytes: 500000000 });
      const [, args] = execFile.mock.calls[0];
      expect(args).toContain('--max-filesize');
      expect(args).toContain('500000000');
      expect(args).toContain('--ffmpeg-location');
      expect(args).toContain('-o');
      expect(args).toContain('/tmp/out.mp4');
      expect(args).toContain('--print');
      expect(args).toContain('after_move:filepath');
      expect(args).toContain('--quiet');
    });

    it('omits --max-filesize when no maxBytes is given', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '/tmp/out.mp4\n', ''));
      await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', {});
      const [, args] = execFile.mock.calls[0];
      expect(args).not.toContain('--max-filesize');
    });

    it('returns the requested path when yt-dlp confirms the file landed exactly there', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '/tmp/out.mp4\n', ''));
      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', {});
      expect(result.filePath).toBe('/tmp/out.mp4');
    });

    it('returns yt-dlp\'s actual final path when post-processing moved the file somewhere other than the requested -o value (the diagnosed real-world bug)', async () => {
      // Documented yt-dlp behavior: merging/post-processing can land the
      // real output at a different path than -o requested. This is
      // exactly what --print after_move:filepath exists to reveal.
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '/tmp/out.fXXX.mp4\n', ''));
      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', {});
      expect(result.filePath).toBe('/tmp/out.fXXX.mp4');
    });

    it('ignores blank lines and returns the last non-empty line as the real path', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '\n\n/tmp/out.mp4\n\n', ''));
      const result = await ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', {});
      expect(result.filePath).toBe('/tmp/out.mp4');
    });

    it('throws a retryable ProviderError if stdout is empty (output location could not be determined)', async () => {
      mockExecFileOnce((bin, args, opts, cb) => cb(null, '', ''));
      await expect(ytdlpRunner.downloadTo('https://youtube.com/watch?v=abc', '/tmp/out.mp4', {})).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: true,
        reason: 'extraction_failed',
      });
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
