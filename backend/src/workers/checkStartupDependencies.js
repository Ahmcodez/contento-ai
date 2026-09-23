const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../logger');
const { resolveFfmpegLocationForYtDlp } = require('../providers/resolveFfmpegLocation');

/**
 * Real production incident this exists to prevent recurring: a worker
 * ran for days with FFMPEG_PATH silently resolved to its literal
 * default ('ffmpeg', unresolvable on that machine) because a stale
 * process never picked up a corrected .env — and the only place that
 * ever surfaced was deep inside a specific job's failure message,
 * multiple debugging rounds after the actual, simple cause. A wrong or
 * unreachable binary path is a boot-time configuration problem, not a
 * per-job one, and deserves to fail loudly in the first few lines of
 * worker startup output, not be discovered by trial and error later.
 *
 * Checks are advisory only — this never blocks startup or throws.
 * Whisper (TRANSCRIPTION_PROVIDER=none by default) and yt-dlp/ffmpeg
 * are all legitimately optional depending on what's configured; the
 * point is visibility (a clear WARN naming the exact resolved path
 * that failed), not enforcement.
 */
function checkBinary(name, binPath, versionArg = '-version') {
  return new Promise((resolve) => {
    execFile(binPath, [versionArg], { timeout: 5000 }, (err) => {
      if (err) {
        logger.warn(
          { binary: name, resolvedPath: binPath, err: err.code || err.message },
          `${name} is not reachable at "${binPath}" — anything depending on it will fail until this is fixed (check the relevant _PATH setting in .env)`,
        );
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function checkStartupDependencies() {
  const results = await Promise.all([
    checkBinary('ffmpeg', config.ffmpeg.ffmpegPath),
    checkBinary('ffprobe', config.ffmpeg.ffprobePath),
    checkBinary('yt-dlp', config.ytdlp.path, '--version'),
  ]);
  const [ffmpegOk, ffprobeOk, ytdlpOk] = results;

  // ffmpeg being reachable above only proves the OS can find it via PATH
  // when THIS app launches it directly — it says nothing about whether
  // yt-dlp can, since yt-dlp's --ffmpeg-location does a literal
  // file-existence check rather than a PATH search (confirmed against a
  // real worker log: a bare "ffmpeg" that works for every direct call in
  // this app made yt-dlp silently skip merging). resolveFfmpegLocation.js
  // now resolves this automatically at download time, but a fresh
  // startup log line makes the state visible immediately either way.
  let ytdlpFfmpegNote = null;
  if (ffmpegOk && ytdlpOk && !path.isAbsolute(config.ffmpeg.ffmpegPath)) {
    const resolved = await resolveFfmpegLocationForYtDlp();
    ytdlpFfmpegNote = resolved;
    if (path.isAbsolute(resolved)) {
      logger.info(
        { configured: config.ffmpeg.ffmpegPath, resolvedForYtDlp: resolved },
        `FFMPEG_PATH ("${config.ffmpeg.ffmpegPath}") is not absolute; auto-resolved to "${resolved}" for yt-dlp downloads that need merging`,
      );
    } else {
      logger.warn(
        { configured: config.ffmpeg.ffmpegPath },
        `FFMPEG_PATH ("${config.ffmpeg.ffmpegPath}") is not absolute and could not be auto-resolved — yt-dlp downloads that need audio/video merging will fail. Set FFMPEG_PATH in .env to an absolute path.`,
      );
    }
  }

  if (ffmpegOk && ffprobeOk && ytdlpOk) {
    logger.info('Startup dependency check: ffmpeg, ffprobe, and yt-dlp are all reachable');
  }
  return { ffmpegOk, ffprobeOk, ytdlpOk, ytdlpFfmpegNote };
}

module.exports = { checkStartupDependencies };
