const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');

/**
 * Real production bug this exists to fix: this app's own ffmpeg/ffprobe
 * calls (MediaProcessor.js) work fine when FFMPEG_PATH is left at its
 * default, bare "ffmpeg" — Windows/Linux both resolve a bare command name
 * against PATH when a process is launched, and that's exactly what
 * execFile('ffmpeg', ...) does. But yt-dlp's own --ffmpeg-location flag
 * does NOT do a PATH search; it does a literal filesystem existence check
 * on the exact string it's given, so the same "ffmpeg" that works
 * everywhere else in this app makes yt-dlp log
 * `ffmpeg-location ffmpeg does not exist! Continuing without ffmpeg` and
 * silently produce a video-only file — confirmed against a real worker
 * log (2026-09). Setting an absolute FFMPEG_PATH in .env works around
 * this, but nothing enforced it, so it kept resetting/getting missed.
 *
 * This resolves a non-absolute ffmpeg path to a real absolute one (via
 * `where`/`which`) once per process and caches it, so URL import works
 * correctly even when FFMPEG_PATH is left at its PATH-relative default —
 * matching what already works for direct ffmpeg calls elsewhere in the app.
 */
let cached;

function resolveViaWhich(command) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [command], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      // `where` can print multiple matches, one per line; take the first.
      const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(first || null);
    });
  });
}

/**
 * Returns an absolute path suitable for yt-dlp's --ffmpeg-location, or
 * the original configured value if it can't be resolved further (yt-dlp
 * will then warn exactly as before — no worse than the status quo).
 */
async function resolveFfmpegLocationForYtDlp() {
  if (cached !== undefined) return cached;

  const configured = config.ffmpeg.ffmpegPath;
  if (path.isAbsolute(configured) && fs.existsSync(configured)) {
    cached = configured;
    return cached;
  }

  const resolved = await resolveViaWhich(configured);
  if (resolved) {
    logger.info(
      { configured, resolved },
      'resolved FFMPEG_PATH to an absolute path for yt-dlp (yt-dlp --ffmpeg-location does not search PATH, unlike this app\'s own ffmpeg calls)',
    );
    cached = resolved;
  } else {
    logger.warn(
      { configured },
      'could not resolve FFMPEG_PATH to an absolute path; yt-dlp downloads that need merging will likely fail — set FFMPEG_PATH in .env to an absolute path',
    );
    cached = configured;
  }
  return cached;
}

/** Test-only: clears the memoized result. */
function _resetCacheForTests() {
  cached = undefined;
}

module.exports = { resolveFfmpegLocationForYtDlp, _resetCacheForTests };
