/**
 * Turns what yt-dlp reports about a video into the choices shown to the visitor:
 * a few MP4 qualities that actually exist for this video (capped at the server's limit), plus MP3.
 * Option ids are the whole contract between the page and the server: 'video-<height>' / 'audio-mp3'.
 */

const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144];
const AUDIO_OPTION_ID = 'audio-mp3';
const VIDEO_OPTION_PATTERN = /^video-(\d{3,4})$/;

function parseOptionId(optionId, { maxHeight }) {
  if (optionId === AUDIO_OPTION_ID) return { mode: 'audio', maxHeight: null };
  const match = VIDEO_OPTION_PATTERN.exec(String(optionId || ''));
  if (!match) return null;
  const height = Number(match[1]);
  if (height < 100 || height > maxHeight) return null;
  return { mode: 'video', maxHeight: height };
}

const bytesLabel = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** Best-effort file size for a quality: the best video at that height plus the best audio, when the site says. */
function estimateBytes(formats, height) {
  const sizeOf = (f) => f.filesize || f.filesize_approx || 0;
  const video = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height === height).map(sizeOf).filter(Boolean);
  const audio = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')).map(sizeOf).filter(Boolean);
  if (video.length === 0) return null;
  return Math.max(...video) + (audio.length ? Math.max(...audio) : 0);
}

function buildOptions(info, { maxHeight }) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const available = new Set(
    formats.filter((f) => f.vcodec && f.vcodec !== 'none' && Number.isInteger(f.height) && f.height > 0).map((f) => f.height),
  );

  // Standard rungs that exist for this video, capped. A stream counts as a rung only if it is within 4%
  // of it (a 718p stream is "720p"; a 1024p one is not "1080p"), so a label never overstates the quality.
  // If a site reports only odd heights, fall back to its own top few.
  let heights = STANDARD_HEIGHTS.filter((h) => h <= maxHeight && [...available].some((a) => a >= h * 0.96 && a <= h * 1.04));
  if (heights.length === 0) heights = [...available].filter((h) => h <= maxHeight).sort((a, b) => b - a).slice(0, 3);
  if (heights.length === 0) heights = [Math.min(maxHeight, 720)]; // formats unknown: offer one sensible choice

  const video = heights.map((height) => {
    const approx = estimateBytes(formats, height);
    return {
      id: `video-${height}`,
      kind: 'video',
      label: `MP4 · ${height}p`,
      height,
      approxBytes: approx,
      approxSizeLabel: approx ? `~${bytesLabel(approx)}` : null,
    };
  });

  return [...video, { id: AUDIO_OPTION_ID, kind: 'audio', label: 'MP3 · audio only', height: null, approxBytes: null, approxSizeLabel: null }];
}

module.exports = { buildOptions, parseOptionId, AUDIO_OPTION_ID };
