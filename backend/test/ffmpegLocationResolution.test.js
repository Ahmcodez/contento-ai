jest.mock('child_process');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { resolveFfmpegLocationForYtDlp, _resetCacheForTests } = require('../src/providers/resolveFfmpegLocation');
const mediaProcessor = require('../src/media/MediaProcessor');
const runner = require('../src/providers/YtDlpRunner');

describe('resolveFfmpegLocationForYtDlp', () => {
  const originalFfmpegPath = config.ffmpeg.ffmpegPath;
  const originalPlatform = process.platform;

  beforeEach(() => {
    execFile.mockReset();
    _resetCacheForTests();
  });

  afterEach(() => {
    config.ffmpeg.ffmpegPath = originalFfmpegPath;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    jest.restoreAllMocks();
  });

  it('returns the configured path unchanged when it is already absolute and exists', async () => {
    const realAbsolute = '/usr/bin/ffmpeg';
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => p === realAbsolute);
    config.ffmpeg.ffmpegPath = realAbsolute;
    const result = await resolveFfmpegLocationForYtDlp();
    expect(result).toBe(realAbsolute);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('resolves a bare command name via `which` on POSIX', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('which');
      expect(args).toEqual(['ffmpeg']);
      cb(null, '/usr/bin/ffmpeg\n', '');
    });
    const result = await resolveFfmpegLocationForYtDlp();
    expect(result).toBe('/usr/bin/ffmpeg');
  });

  it('resolves via `where` on Windows and takes the first of multiple matches', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('where');
      cb(null, 'C:\\WinGet\\Links\\ffmpeg.exe\r\nC:\\Other\\ffmpeg.exe\r\n', '');
    });
    const result = await resolveFfmpegLocationForYtDlp();
    expect(result).toBe('C:\\WinGet\\Links\\ffmpeg.exe');
  });

  it('falls back to the configured value (unchanged) when resolution fails, and does not throw', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('not found')));
    const result = await resolveFfmpegLocationForYtDlp();
    expect(result).toBe('ffmpeg');
  });

  it('memoizes: only resolves once even across many calls', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, '/usr/bin/ffmpeg\n', ''));
    await resolveFfmpegLocationForYtDlp();
    await resolveFfmpegLocationForYtDlp();
    await resolveFfmpegLocationForYtDlp();
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});

describe('YtDlpRunner.downloadTo uses the resolved ffmpeg location, not the raw config value', () => {
  let tmpFile;
  const originalFfmpegPath = config.ffmpeg.ffmpegPath;
  const originalPlatform = process.platform;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `ytdlp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    fs.writeFileSync(tmpFile, 'fake video bytes');
    execFile.mockReset();
    _resetCacheForTests();
    Object.defineProperty(process, 'platform', { value: 'linux' });
  });

  afterEach(() => {
    fs.rmSync(tmpFile, { force: true });
    config.ffmpeg.ffmpegPath = originalFfmpegPath;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    _resetCacheForTests();
    jest.restoreAllMocks();
  });

  // End-to-end through the REAL resolveFfmpegLocationForYtDlp (not stubbed —
  // YtDlpRunner destructures it at require time, so a module-level spy
  // wouldn't be seen by YtDlpRunner's own reference anyway). This is the
  // exact chain that was broken in production: config.ffmpeg.ffmpegPath is
  // a bare, non-absolute "ffmpeg" the whole way through, and downloadTo
  // must still end up passing an absolute path to yt-dlp.
  it('passes the resolved absolute path (not the raw non-absolute config value) as --ffmpeg-location', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    jest.spyOn(mediaProcessor, 'probe').mockResolvedValue({ hasAudio: true });
    let seenArgs;
    execFile.mockImplementation((bin, args, opts, cb) => {
      if (bin === 'which') return cb(null, '/usr/bin/ffmpeg\n', ''); // one-time resolution, then cached
      seenArgs = args; // the actual yt-dlp download invocation
      return cb(null, `${tmpFile}\n`, '');
    });

    const result = await runner.downloadTo('https://example.com/v', tmpFile);

    expect(result.filePath).toBe(tmpFile);
    expect(seenArgs).toEqual(expect.arrayContaining(['--ffmpeg-location', '/usr/bin/ffmpeg']));
    expect(seenArgs).not.toContain('ffmpeg'); // never the raw, non-absolute config value
  });

  it('still downloads correctly (with a diagnosable warning) when resolution fails entirely', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    jest.spyOn(mediaProcessor, 'probe').mockResolvedValue({ hasAudio: true });
    let seenArgs;
    execFile.mockImplementation((bin, args, opts, cb) => {
      if (bin === 'which') return cb(new Error('not found'));
      seenArgs = args;
      return cb(null, `${tmpFile}\n`, '');
    });

    const result = await runner.downloadTo('https://example.com/v', tmpFile);

    expect(result.filePath).toBe(tmpFile);
    expect(seenArgs).toEqual(expect.arrayContaining(['--ffmpeg-location', 'ffmpeg'])); // unchanged fallback, not a crash
  });
});

describe('checkStartupDependencies surfaces the ffmpeg-location gap at boot', () => {
  const originalFfmpegPath = config.ffmpeg.ffmpegPath;

  beforeEach(() => {
    execFile.mockReset();
    _resetCacheForTests();
  });

  afterEach(() => {
    config.ffmpeg.ffmpegPath = originalFfmpegPath;
    jest.restoreAllMocks();
    _resetCacheForTests();
  });

  it('warns at boot when FFMPEG_PATH is not absolute and cannot be auto-resolved', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((bin, args, opts, cb) => {
      if (['where', 'which'].includes(bin)) return cb(new Error('not found'));
      return cb(null, '', ''); // -version / --version checks
    });
    const logger = require('../src/logger');
    const warnSpy = jest.spyOn(logger, 'warn');
    const { checkStartupDependencies } = require('../src/workers/checkStartupDependencies');

    const result = await checkStartupDependencies();
    expect(result.ffmpegOk).toBe(true);
    expect(result.ytdlpFfmpegNote).toBe('ffmpeg');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ configured: 'ffmpeg' }),
      expect.stringContaining('yt-dlp downloads that need audio/video merging will fail'),
    );
  });

  it('logs an informational note (not a warning) when auto-resolution succeeds', async () => {
    config.ffmpeg.ffmpegPath = 'ffmpeg';
    execFile.mockImplementation((bin, args, opts, cb) => {
      if (['where', 'which'].includes(bin)) return cb(null, '/usr/bin/ffmpeg\n', '');
      return cb(null, '', '');
    });
    const logger = require('../src/logger');
    const warnSpy = jest.spyOn(logger, 'warn');
    const infoSpy = jest.spyOn(logger, 'info');
    const { checkStartupDependencies } = require('../src/workers/checkStartupDependencies');

    const result = await checkStartupDependencies();
    expect(result.ytdlpFfmpegNote).toBe('/usr/bin/ffmpeg');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedForYtDlp: '/usr/bin/ffmpeg' }),
      expect.stringContaining('auto-resolved'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('will fail'));
  });

  it('does nothing extra when FFMPEG_PATH is already absolute', async () => {
    config.ffmpeg.ffmpegPath = path.resolve('/opt/ffmpeg/ffmpeg');
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => p === config.ffmpeg.ffmpegPath);
    execFile.mockImplementation((bin, args, opts, cb) => cb(null, '', ''));
    const { checkStartupDependencies } = require('../src/workers/checkStartupDependencies');
    const result = await checkStartupDependencies();
    expect(result.ytdlpFfmpegNote).toBeNull();
  });
});
