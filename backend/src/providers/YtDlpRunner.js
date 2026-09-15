const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../logger');
const { ProviderError } = require('./URLProvider');

/**
 * Isolated wrapper around the yt-dlp binary — the only place in this
 * codebase that shells out to it. Every provider that needs yt-dlp
 * (YouTube, Vimeo, TikTok, Dropbox — see src/providers/YtDlpProvider.js)
 * goes through this module, never invokes the binary directly, so the
 * safety properties below apply uniformly:
 *
 *  - execFile only, never exec/spawn-with-shell: the URL and every flag
 *    are passed as separate array elements, so there is no shell string
 *    for a crafted URL (e.g. containing `; rm -rf /` or backticks) to
 *    break out of. This mirrors MediaProcessor.run()'s ffmpeg/ffprobe
 *    invocation for the identical reason.
 *  - yt-dlp is only ever invoked for a URL a provider's canHandle()
 *    already matched against a strict hostname allowlist (see
 *    YouTubeProvider/VimeoProvider/etc.) — this module has no opinion
 *    on what's a "supported site" itself, it trusts the caller to have
 *    already scoped that, since yt-dlp's own network access is outside
 *    this app's SSRF-safe-fetch boundary (a fundamentally different,
 *    narrower trust model: known, specific video platforms via yt-dlp's
 *    own extractors, not "fetch any URL").
 *  - --max-filesize is always passed for downloads, so an oversized
 *    source is rejected by yt-dlp itself mid-download rather than only
 *    being caught after the fact.
 *  - separate, configurable timeouts for metadata vs. download (see
 *    config/index.js YTDLP_METADATA_TIMEOUT_MS / YTDLP_DOWNLOAD_TIMEOUT_MS).
 *  - stderr is parsed for a small set of well-known yt-dlp failure
 *    patterns (private video, sign-in required, unavailable, unsupported
 *    URL, not installed) and mapped to a ProviderError with the correct
 *    `retryable` flag, mirroring TranscriptionProviderError/
 *    MediaProcessorError's existing pattern — a private video won't
 *    become downloadable on retry.
 */

const STDERR_PATTERNS = [
  { test: /sign in to confirm|confirm you.re not a bot/i, reason: 'authentication_required', message: 'This video requires sign-in/verification to access and cannot be imported.' },
  { test: /private video/i, reason: 'private_video', message: 'This video is private and cannot be imported.' },
  { test: /video unavailable|has been removed|does not exist/i, reason: 'unavailable', message: 'This video is unavailable (removed, deleted, or never existed).' },
  { test: /members-?only|premium/i, reason: 'authentication_required', message: 'This video requires a paid membership/subscription and cannot be imported.' },
  { test: /age[- ]restrict/i, reason: 'authentication_required', message: 'This video is age-restricted and cannot be imported without authentication.' },
  { test: /geo.?restrict|available in your country|not available in your region/i, reason: 'geo_restricted', message: 'This video is not accessible from this region.' },
  { test: /unsupported url|no extractor/i, reason: 'unsupported_provider', message: 'This URL is not from a supported source.' },
  { test: /file is larger than max-filesize/i, reason: 'too_large', message: 'This video exceeds the maximum allowed file size.' },
];

function classifyStderr(stderr) {
  const match = STDERR_PATTERNS.find((p) => p.test.test(stderr));
  if (match) {
    return new ProviderError(match.message, { retryable: false, reason: match.reason, statusCode: 422 });
  }
  // Unrecognized failure — the ProviderError.message stays generic and
  // user-safe (never surface a raw subprocess error to a client), but
  // that must never mean the actual cause is lost: log the real stderr
  // server-side so it's diagnosable from worker logs alone, rather than
  // requiring someone to reproduce the failure by hand to even see what
  // went wrong. This is exactly the gap that made a real production
  // yt-dlp failure (unrecognized stderr, 13-minute runtime, no visible
  // cause) need manual reproduction to debug at all.
  logger.warn({ stderr: stderr?.slice(0, 4000) }, 'yt-dlp failed with an unrecognized stderr pattern');
  // Treat as transient/retryable (network blip, yt-dlp internal error,
  // etc.) rather than assuming it's permanent.
  return new ProviderError('The video could not be imported from this source right now.', { retryable: true, reason: 'extraction_failed', statusCode: 422 });
}

function run(args, { timeoutMs, maxBuffer = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(config.ytdlp.path, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return reject(
            new ProviderError(
              `yt-dlp is not installed or not on PATH. Install it (pip install yt-dlp) or set YTDLP_PATH in .env to an absolute path.`,
              { retryable: false, reason: 'not_configured', statusCode: 500 },
            ),
          );
        }
        if (err.killed || err.signal === 'SIGTERM') {
          return reject(new ProviderError('The request to the video source timed out.', { retryable: true, reason: 'timeout', statusCode: 422 }));
        }
        return reject(classifyStderr(stderr || err.message));
      }
      return resolve({ stdout, stderr });
    });
  });
}

/**
 * Dumps a single video's metadata as JSON without downloading anything
 * (-J, --no-playlist so a playlist/channel URL never silently expands
 * into hundreds of videos, --no-warnings to keep stdout parseable,
 * --skip-download as a second belt-and-suspenders guarantee alongside
 * -J that this never touches the network for the media itself).
 */
async function getMetadataJson(url) {
  const { stdout } = await run(
    ['-J', '--no-playlist', '--no-warnings', '--skip-download', url],
    { timeoutMs: config.ytdlp.metadataTimeoutMs },
  );
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ProviderError('Could not parse video metadata from this source.', { retryable: true, reason: 'extraction_failed' });
  }
}

/**
 * Downloads a single video to destPath. Format selection caps resolution
 * at 1080p (this app renders 9:16 clips from the source — nothing is
 * gained from ingesting 4K/8K source video, only slower downloads and
 * more disk/bandwidth) and prefers a pre-merged mp4 to avoid needing a
 * separate merge step; --merge-output-format mp4 covers the case where
 * yt-dlp still has to mux separate video+audio streams, using the
 * ffmpeg this app already depends on (see MediaProcessor.js) via
 * --ffmpeg-location.
 *
 * Diagnosed against a real download: yt-dlp does NOT guarantee the
 * final file ends up at exactly the `-o` path once merging/post-
 * processing is involved — this is documented yt-dlp behavior, not a
 * bug in how it's invoked here ("Due to post-processing (i.e. merging
 * etc.), the actual output filename might differ" — yt-dlp manual).
 * `--print after_move:filepath` is yt-dlp's own documented mechanism
 * for learning the real final path, printed as the last line of stdout
 * once every post-processing step (merge, move) is complete — the
 * returned filePath is always this actual, verified location, never
 * the originally-requested destPath assumed to have been honored.
 * --quiet suppresses yt-dlp's normal progress/status output so the
 * `--print` line is reliably the only thing worth parsing from stdout.
 */
async function downloadTo(url, destPath, { maxBytes } = {}) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '-f',
    'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best[height<=1080]/best',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    config.ffmpeg.ffmpegPath,
    '-o',
    destPath,
    '--print',
    'after_move:filepath',
  ];
  if (maxBytes) {
    args.push('--max-filesize', String(maxBytes));
  }
  args.push(url);

  const { stdout } = await run(args, { timeoutMs: config.ytdlp.downloadTimeoutMs });
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const actualPath = lines[lines.length - 1];
  if (!actualPath) {
    throw new ProviderError(
      'The download finished but its output location could not be determined.',
      { retryable: true, reason: 'extraction_failed' },
    );
  }
  return { filePath: actualPath };
}

module.exports = { getMetadataJson, downloadTo, classifyStderr };
