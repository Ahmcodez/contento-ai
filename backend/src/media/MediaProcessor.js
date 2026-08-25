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
 * broader captioning/reframing note). No caption burn-in yet in this
 * milestone — added when the clip-rendering pipeline stage is built.
 */
async function renderVerticalClip(inputPath, outputPath, { startMs, endMs }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid clip bounds');
  }
  const startSeconds = (startMs / 1000).toFixed(3);
  const durationSeconds = ((endMs - startMs) / 1000).toFixed(3);

  const args = [
    '-y',
    '-ss', startSeconds,
    '-i', inputPath,
    '-t', durationSeconds,
    '-vf', "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920",
    '-c:v', 'libx264',
    '-c:a', 'aac',
    outputPath,
  ];
  await run(config.ffmpeg.ffmpegPath, args);
  return outputPath;
}

module.exports = { probe, extractAudio, renderVerticalClip };
