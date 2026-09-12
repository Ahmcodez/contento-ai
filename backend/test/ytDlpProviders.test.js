jest.mock('../src/providers/YtDlpRunner');
const ytdlpRunner = require('../src/providers/YtDlpRunner');
const YouTubeProvider = require('../src/providers/YouTubeProvider');
const VimeoProvider = require('../src/providers/VimeoProvider');
const TikTokProvider = require('../src/providers/TikTokProvider');
const DropboxProvider = require('../src/providers/DropboxProvider');
const { resolveProvider } = require('../src/providers/ProviderResolver');

describe('YouTube/Vimeo/TikTok/Dropbox providers', () => {
  afterEach(() => jest.clearAllMocks());

  describe.each([
    ['YouTubeProvider', new YouTubeProvider(), 'youtube', [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
    ], [
      'https://vimeo.com/12345',
      'https://evil.com/?redirect=youtube.com',
      'https://youtube.com.evil.com/watch?v=x',
      'https://notyoutube.com/watch?v=x',
      'not a url',
    ]],
    ['VimeoProvider', new VimeoProvider(), 'vimeo', [
      'https://vimeo.com/12345',
      'https://www.vimeo.com/12345',
      'https://player.vimeo.com/video/12345',
    ], [
      'https://youtube.com/watch?v=x',
      'https://vimeo.com.evil.com/12345',
      'https://evil.com/?u=vimeo.com',
    ]],
    ['TikTokProvider', new TikTokProvider(), 'tiktok', [
      'https://www.tiktok.com/@user/video/12345',
      'https://vm.tiktok.com/abc123',
      'https://vt.tiktok.com/abc123',
    ], [
      'https://youtube.com/watch?v=x',
      'https://tiktok.com.evil.com/@user/video/1',
    ]],
    ['DropboxProvider', new DropboxProvider(), 'dropbox', [
      'https://www.dropbox.com/s/abc123/video.mp4?dl=0',
      'https://dl.dropboxusercontent.com/s/abc123/video.mp4',
    ], [
      'https://youtube.com/watch?v=x',
      'https://dropbox.com.evil.com/s/abc/video.mp4',
    ]],
  ])('%s', (_label, provider, expectedName, validUrls, invalidUrls) => {
    it(`has name "${expectedName}"`, () => {
      expect(provider.name).toBe(expectedName);
    });

    it.each(validUrls)('accepts %s', (url) => {
      expect(provider.canHandle(url)).toBe(true);
    });

    it.each(invalidUrls)('rejects %s (including hostname-spoofing attempts)', (url) => {
      expect(provider.canHandle(url)).toBe(false);
    });
  });

  describe('getMetadata / download plumbing (shared YtDlpProvider base)', () => {
    it('getMetadata normalizes YtDlpRunner output into the standard shape', async () => {
      ytdlpRunner.getMetadataJson.mockResolvedValue({
        id: 'abc123',
        title: 'A great video',
        thumbnail: 'https://example.com/t.jpg',
        duration: 125.4,
        width: 1920,
        height: 1080,
        filesize: 50_000_000,
      });

      const provider = new YouTubeProvider();
      const meta = await provider.getMetadata('https://youtube.com/watch?v=abc123');

      expect(meta).toEqual({
        sourceId: 'abc123',
        title: 'A great video',
        thumbnailUrl: 'https://example.com/t.jpg',
        durationSeconds: 125.4,
        width: 1920,
        height: 1080,
        sizeBytes: 50_000_000,
      });
    });

    it('getMetadata leaves fields null when yt-dlp does not provide them, rather than guessing', async () => {
      ytdlpRunner.getMetadataJson.mockResolvedValue({ id: 'abc123', title: 'x' });
      const provider = new YouTubeProvider();
      const meta = await provider.getMetadata('https://youtube.com/watch?v=abc123');
      expect(meta.durationSeconds).toBeNull();
      expect(meta.width).toBeNull();
      expect(meta.sizeBytes).toBeNull();
    });

    it('download delegates to YtDlpRunner.downloadTo with maxBytes forwarded', async () => {
      ytdlpRunner.downloadTo.mockResolvedValue({ filePath: '/tmp/out.mp4' });
      const provider = new YouTubeProvider();
      const result = await provider.download('https://youtube.com/watch?v=abc123', '/tmp/out.mp4', { maxBytes: 123 });
      expect(ytdlpRunner.downloadTo).toHaveBeenCalledWith('https://youtube.com/watch?v=abc123', '/tmp/out.mp4', { maxBytes: 123 });
      expect(result.filePath).toBe('/tmp/out.mp4');
    });

    it('propagates a ProviderError from YtDlpRunner unchanged (e.g. private video)', async () => {
      const { ProviderError } = require('../src/providers/URLProvider');
      ytdlpRunner.getMetadataJson.mockRejectedValue(new ProviderError('This video is private', { retryable: false, reason: 'private_video' }));
      const provider = new YouTubeProvider();
      await expect(provider.getMetadata('https://youtube.com/watch?v=abc123')).rejects.toMatchObject({ reason: 'private_video' });
    });
  });
});

describe('ProviderResolver priority ordering', () => {
  it('resolves a YouTube URL to YouTubeProvider, not DirectMediaProvider', () => {
    expect(resolveProvider('https://youtube.com/watch?v=abc123').name).toBe('youtube');
  });

  it('resolves a Vimeo URL to VimeoProvider', () => {
    expect(resolveProvider('https://vimeo.com/12345').name).toBe('vimeo');
  });

  it('resolves a TikTok URL to TikTokProvider', () => {
    expect(resolveProvider('https://www.tiktok.com/@user/video/12345').name).toBe('tiktok');
  });

  it('resolves a Dropbox URL to DropboxProvider', () => {
    expect(resolveProvider('https://www.dropbox.com/s/abc/video.mp4').name).toBe('dropbox');
  });

  it('falls through to DirectMediaProvider for a plain video file URL', () => {
    expect(resolveProvider('https://cdn.example.com/clip.mp4').name).toBe('direct');
  });

  it('rejects a hostname-spoofing attempt rather than matching it to a real provider', () => {
    expect(() => resolveProvider('https://youtube.com.evil.com/watch?v=x')).toThrow();
  });
});
