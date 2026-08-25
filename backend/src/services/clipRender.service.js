const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const mediaProcessor = require('../media/MediaProcessor');
const { buildCaptionCues, cuesToSrt } = require('../media/CaptionGenerator');
const { segmentsInRange } = require('../transcript/normalize');
const { getStorageDriver } = require('../storage');
const generatedClipRepository = require('../repositories/generatedClip.repository');

/**
 * Renders one approved clip candidate to a 9:16 video with burned-in
 * captions and a thumbnail. Every intermediate/final file goes through
 * MediaProcessor.validateOutput before being trusted or stored
 * (docs/SECURITY.md — never trust an FFmpeg exit code alone).
 */
async function renderClip({ mediaAsset, transcriptSegments, clipCandidate }) {
  const storageDriver = getStorageDriver();
  await generatedClipRepository.markRendering(clipCandidate.id);

  const workDir = path.join(config.storage.tmpPath, `clip-${clipCandidate.id}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const sourcePath = await storageDriver.getAbsolutePath(mediaAsset.storage_key);

    const relevantSegments = segmentsInRange(transcriptSegments, clipCandidate.start_ms, clipCandidate.end_ms);
    const cues = buildCaptionCues(relevantSegments, {
      startMs: clipCandidate.start_ms,
      endMs: clipCandidate.end_ms,
    });
    const srtPath = path.join(workDir, 'captions.srt');
    await fs.writeFile(srtPath, cuesToSrt(cues), 'utf-8');

    const renderedPath = path.join(workDir, 'clip.mp4');
    await mediaProcessor.renderVerticalClip(sourcePath, renderedPath, {
      startMs: clipCandidate.start_ms,
      endMs: clipCandidate.end_ms,
      subtitlePath: cues.length > 0 ? srtPath : undefined,
    });
    const validated = await mediaProcessor.validateOutput(renderedPath);

    const thumbnailPath = path.join(workDir, 'thumbnail.jpg');
    await mediaProcessor.generateThumbnail(renderedPath, thumbnailPath, { atSeconds: Math.min(1, validated.durationSeconds / 4) });

    const baseKey = mediaAsset.storage_key.replace(path.extname(mediaAsset.storage_key), '');
    const clipStorageKey = `${baseKey}.clips/${clipCandidate.id}.mp4`;
    const thumbnailStorageKey = `${baseKey}.clips/${clipCandidate.id}.thumb.jpg`;
    const subtitleStorageKey = cues.length > 0 ? `${baseKey}.clips/${clipCandidate.id}.srt` : null;

    await storageDriver.saveFromPath(clipStorageKey, renderedPath);
    await storageDriver.saveFromPath(thumbnailStorageKey, thumbnailPath);
    if (subtitleStorageKey) {
      await storageDriver.saveFromPath(subtitleStorageKey, srtPath);
    }

    const generatedClip = await generatedClipRepository.markRendered(clipCandidate.id, {
      storageKey: clipStorageKey,
      thumbnailStorageKey,
      subtitleStorageKey,
      durationSeconds: validated.durationSeconds,
    });

    return generatedClip;
  } catch (err) {
    await generatedClipRepository.markFailed(clipCandidate.id, err.message);
    throw err;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { renderClip };
