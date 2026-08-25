const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const mediaProcessor = require('../src/media/MediaProcessor');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.mp4');

describe('MediaProcessor (real ffmpeg)', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-test-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  describe('probe', () => {
    it('extracts real duration, resolution and audio presence', async () => {
      const result = await mediaProcessor.probe(FIXTURE);
      expect(result.durationSeconds).toBeCloseTo(4, 0);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.hasAudio).toBe(true);
    });

    it('reports hasAudio false for a video-only file', async () => {
      const videoOnlyPath = path.join(workDir, 'video-only.mp4');
      const { execFile } = require('child_process');
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', '-y', videoOnlyPath], (err) =>
          err ? reject(err) : resolve(),
        );
      });
      const result = await mediaProcessor.probe(videoOnlyPath);
      expect(result.hasAudio).toBe(false);
    });

    it('throws for a nonexistent file', async () => {
      await expect(mediaProcessor.probe('/tmp/does-not-exist-xyz.mp4')).rejects.toThrow();
    });
  });

  describe('extractAudio', () => {
    it('produces a real, valid audio file', async () => {
      const outputPath = path.join(workDir, 'audio.wav');
      await mediaProcessor.extractAudio(FIXTURE, outputPath);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);

      const probed = await mediaProcessor.probe(outputPath);
      expect(probed.durationSeconds).toBeCloseTo(4, 0);
    });
  });

  describe('renderVerticalClip', () => {
    it('renders a 9:16 clip of the requested duration', async () => {
      const outputPath = path.join(workDir, 'clip.mp4');
      await mediaProcessor.renderVerticalClip(FIXTURE, outputPath, { startMs: 500, endMs: 2500 });

      const probed = await mediaProcessor.probe(outputPath);
      expect(probed.durationSeconds).toBeCloseTo(2, 0);
      // 9:16 aspect ratio check (width/height ratio)
      expect(probed.width / probed.height).toBeCloseTo(9 / 16, 1);
    });

    it('rejects invalid clip bounds (end before start)', async () => {
      const outputPath = path.join(workDir, 'bad-clip.mp4');
      await expect(
        mediaProcessor.renderVerticalClip(FIXTURE, outputPath, { startMs: 2000, endMs: 1000 }),
      ).rejects.toThrow('Invalid clip bounds');
    });

    it('rejects non-numeric clip bounds', async () => {
      const outputPath = path.join(workDir, 'bad-clip2.mp4');
      await expect(
        mediaProcessor.renderVerticalClip(FIXTURE, outputPath, { startMs: NaN, endMs: 2000 }),
      ).rejects.toThrow('Invalid clip bounds');
    });
  });

  describe('generateThumbnail', () => {
    it('produces a real image file', async () => {
      const outputPath = path.join(workDir, 'thumb.jpg');
      await mediaProcessor.generateThumbnail(FIXTURE, outputPath, { atSeconds: 1 });
      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('validateOutput', () => {
    it('accepts a genuinely valid rendered file', async () => {
      const outputPath = path.join(workDir, 'clip.mp4');
      await mediaProcessor.renderVerticalClip(FIXTURE, outputPath, { startMs: 0, endMs: 2000 });
      const result = await mediaProcessor.validateOutput(outputPath);
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.durationSeconds).toBeCloseTo(2, 0);
    });

    it('rejects a nonexistent file', async () => {
      await expect(mediaProcessor.validateOutput(path.join(workDir, 'nope.mp4'))).rejects.toThrow('does not exist');
    });

    it('rejects an empty file', async () => {
      const emptyPath = path.join(workDir, 'empty.mp4');
      await fs.writeFile(emptyPath, '');
      await expect(mediaProcessor.validateOutput(emptyPath)).rejects.toThrow('empty');
    });

    it('rejects a file that is not real decodable media', async () => {
      const junkPath = path.join(workDir, 'junk.mp4');
      await fs.writeFile(junkPath, 'this is not a video file at all');
      await expect(mediaProcessor.validateOutput(junkPath)).rejects.toThrow();
    });
  });
});
