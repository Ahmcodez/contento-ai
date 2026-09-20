const config = require('../src/config');
const { checkStartupDependencies } = require('../src/workers/checkStartupDependencies');

describe('checkStartupDependencies', () => {
  let originalFfmpeg;
  let originalFfprobe;
  let originalYtdlp;

  beforeEach(() => {
    originalFfmpeg = config.ffmpeg.ffmpegPath;
    originalFfprobe = config.ffmpeg.ffprobePath;
    originalYtdlp = config.ytdlp.path;
  });

  afterEach(() => {
    config.ffmpeg.ffmpegPath = originalFfmpeg;
    config.ffmpeg.ffprobePath = originalFfprobe;
    config.ytdlp.path = originalYtdlp;
  });

  it('reports all three as reachable when they are real, working binaries (this sandbox has them installed)', async () => {
    const result = await checkStartupDependencies();
    expect(result).toEqual({ ffmpegOk: true, ffprobeOk: true, ytdlpOk: true });
  });

  it('reports ffmpeg as unreachable when the configured path is bogus — reproduces the exact real-world incident (config silently left at the literal default)', async () => {
    config.ffmpeg.ffmpegPath = 'definitely-not-a-real-binary-xyz';
    const result = await checkStartupDependencies();
    expect(result.ffmpegOk).toBe(false);
    expect(result.ffprobeOk).toBe(true);
    expect(result.ytdlpOk).toBe(true);
  });

  it('logs a WARN naming the exact resolved path that failed, not just a generic message', async () => {
    const logger = require('../src/logger');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    config.ffmpeg.ffmpegPath = 'definitely-not-a-real-binary-xyz';

    await checkStartupDependencies();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ binary: 'ffmpeg', resolvedPath: 'definitely-not-a-real-binary-xyz' }),
      expect.stringContaining('not reachable'),
    );
    warnSpy.mockRestore();
  });

  it('never throws, even when every binary is unreachable', async () => {
    config.ffmpeg.ffmpegPath = 'nope-ffmpeg';
    config.ffmpeg.ffprobePath = 'nope-ffprobe';
    config.ytdlp.path = 'nope-ytdlp';
    await expect(checkStartupDependencies()).resolves.toEqual({ ffmpegOk: false, ffprobeOk: false, ytdlpOk: false });
  });
});
