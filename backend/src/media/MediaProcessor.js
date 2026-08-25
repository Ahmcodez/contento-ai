const { execFile } = require('child_process');
const config = require('../config');

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per invocation, bounds a hung/malicious input

function run(binPath, args, { timeout = FFMPEG_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // execFile never invokes a shell — args are passed as an array, so
    // there is no string for a crafted value to break out of.
    execFile(binPath, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`${binPath} failed: ${err.message}`);
        e.stderr = stderr;
        e.killed = err.killed;
        return reject(e);
      }
      return resolve({ stdout, stderr });
    });
  });
}

/**
 * Probes a video file and returns { durationSeconds, codec, width, height }.
 * All inputs are absolute file paths already resolved by StorageDriver —
 * never a client-supplied string.
 */
async function probe(absoluteFilePath) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_name,width,height,codec_type',
    '-of', 'json',
    absoluteFilePath,
  ];
  const { stdout } = await run(config.ffmpeg.ffprobePath, args);
  const parsed = JSON.parse(stdout);
  const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
  const hasAudio = (parsed.streams || []).some((s) => s.codec_type === 'audio');
  return {
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : null,
    codec: videoStream?.codec_name || null,
    width: videoStream?.width || null,
    height: videoStream?.height || null,
    hasAudio,
  };
}

/**
 * Extracts a mono, 16kHz WAV audio track — the format most STT providers
 * (including local Whisper) expect. startMs/endMs are always validated,
 * numeric, and clamped by the caller before reaching here (see
 * docs/SECURITY.md §4) — this function never receives raw user input.
 */
async function extractAudio(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    outputPath,
  ];
  await run(config.ffmpeg.ffmpegPath, args);
  return outputPath;
}

/**
 * Cuts a clip [startMs, endMs) from the source video and reframes to
 * 9:16 via center-crop (deterministic — see docs/PIPELINE.md §3.8 for the
 * broader captioning/reframing note). If subtitlePath is given, captions
 * are burned in via FFmpeg's subtitles filter using the same crop/scale
 * pass (one encode, not two).
 */
async function renderVerticalClip(inputPath, outputPath, { startMs, endMs, subtitlePath } = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid clip bounds');
  }
  const startSeconds = (startMs / 1000).toFixed(3);
  const durationSeconds = ((endMs - startMs) / 1000).toFixed(3);

  const cropScale = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920";
  const videoFilter = subtitlePath
    ? `${cropScale},subtitles='${escapeForFilterPath(subtitlePath)}'`
    : cropScale;

  const args = [
    '-y',
    '-ss', startSeconds,
    '-i', inputPath,
    '-t', durationSeconds,
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    outputPath,
  ];
  await run(config.ffmpeg.ffmpegPath, args);
  return outputPath;
}

/**
 * The subtitles filter parses its path argument through its own
 * mini-syntax where ':' and other characters are significant — this
 * escapes it defensively. The path itself is always a server-generated
 * temp file path (never client input), but escaping is cheap insurance.
 */
function escapeForFilterPath(filterPath) {
  return filterPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Generates a single-frame JPEG thumbnail at the given offset into the
 * source (defaults to 10% into the clip, a reasonable "not a black
 * frame" heuristic for short clips).
 */
async function generateThumbnail(inputPath, outputPath, { atSeconds = 0 } = {}) {
  const args = [
    '-y',
    '-ss', atSeconds.toFixed(3),
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '3',
    outputPath,
  ];
  await run(config.ffmpeg.ffmpegPath, args);
  return outputPath;
}

/**
 * Validates a rendered output file actually exists, is non-empty, is
 * within the configured size ceiling, and is a decodable media file —
 * catches a truncated/corrupt render before it's stored or presented to
 * the user (docs/COST.md, docs/SECURITY.md — never trust an FFmpeg exit
 * code alone as proof of a valid output).
 */
async function validateOutput(outputPath) {
  const fs = require('fs/promises');
  let stat;
  try {
    stat = await fs.stat(outputPath);
  } catch {
    throw new Error(`Rendered output does not exist: ${outputPath}`);
  }

  if (stat.size === 0) {
    throw new Error(`Rendered output is empty: ${outputPath}`);
  }

  const maxBytes = config.ffmpeg.outputMaxSizeMb * 1024 * 1024;
  if (stat.size > maxBytes) {
    throw new Error(`Rendered output exceeds max size (${stat.size} bytes > ${maxBytes} bytes)`);
  }

  // Re-probe the output itself to confirm it's genuinely decodable, not
  // just a file that happens to exist with the right byte count.
  const probeResult = await probe(outputPath);
  if (!probeResult.durationSeconds) {
    throw new Error(`Rendered output is not a valid/decodable media file: ${outputPath}`);
  }

  return { sizeBytes: stat.size, durationSeconds: probeResult.durationSeconds };
}

module.exports = { probe, extractAudio, renderVerticalClip, generateThumbnail, validateOutput };
