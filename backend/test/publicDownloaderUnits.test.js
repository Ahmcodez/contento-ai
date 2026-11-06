const { buildOptions, parseOptionId } = require('../src/tools/downloader/options');
const { sanitizeFilename, contentDisposition } = require('../src/tools/downloader/filename');

const video = (height, filesize) => ({ vcodec: 'avc1', acodec: 'none', height, filesize });
const audio = (filesize) => ({ vcodec: 'none', acodec: 'mp4a', filesize });

describe('buildOptions', () => {
  it('offers the qualities this video really has, capped at the server limit, plus MP3', () => {
    const info = { formats: [video(144), video(360), video(720, 1_000_000), video(1080), video(2160), audio(200_000)] };
    const options = buildOptions(info, { maxHeight: 1080 });
    expect(options.map((o) => o.id)).toEqual(['video-1080', 'video-720', 'video-360', 'video-144', 'audio-mp3']);
    expect(options[1]).toMatchObject({ label: 'MP4 · 720p', kind: 'video', height: 720, approxBytes: 1_200_000 });
    expect(options[1].approxSizeLabel).toBe('~1 MB');
    expect(options.at(-1)).toMatchObject({ kind: 'audio', label: 'MP3 · audio only' });
  });

  it('never offers a quality above the cap, even if the video has it', () => {
    const options = buildOptions({ formats: [video(2160), video(1440), video(1080), video(720)] }, { maxHeight: 720 });
    expect(options.filter((o) => o.kind === 'video').map((o) => o.height)).toEqual([720]);
  });

  it('matches a slightly off height to its standard quality (a 718p stream is "720p")', () => {
    const options = buildOptions({ formats: [video(718), video(478)] }, { maxHeight: 1080 });
    expect(options.filter((o) => o.kind === 'video').map((o) => o.height)).toEqual([720, 480]);
  });

  it('falls back to a site\'s own heights when none are standard', () => {
    const options = buildOptions({ formats: [video(1024), video(576), video(300), video(100)] }, { maxHeight: 1080 });
    expect(options.filter((o) => o.kind === 'video').map((o) => o.height)).toEqual([1024, 576, 300]);
  });

  it('still offers one sensible choice plus MP3 when the site reports no formats', () => {
    expect(buildOptions({}, { maxHeight: 1080 }).map((o) => o.id)).toEqual(['video-720', 'audio-mp3']);
  });

  it('shows no size when the site does not say', () => {
    expect(buildOptions({ formats: [video(720)] }, { maxHeight: 1080 })[0].approxSizeLabel).toBeNull();
  });
});

describe('parseOptionId', () => {
  const limits = { maxHeight: 1080 };
  it('accepts audio and any video height up to the limit', () => {
    expect(parseOptionId('audio-mp3', limits)).toEqual({ mode: 'audio', maxHeight: null });
    expect(parseOptionId('video-720', limits)).toEqual({ mode: 'video', maxHeight: 720 });
    expect(parseOptionId('video-1080', limits)).toEqual({ mode: 'video', maxHeight: 1080 });
  });

  it.each(['video-2160', 'video-50', 'video-', 'video-abc', 'audio', 'mp4', '', undefined, null, 'video-720; rm -rf /', 'video-0720x'])('rejects %p', (bad) => {
    expect(parseOptionId(bad, limits)).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('removes characters filesystems and browsers reject, and keeps the extension', () => {
    expect(sanitizeFilename('Test: Video / Name?', '.mp4')).toBe('Test Video Name.mp4');
    expect(sanitizeFilename('a<b>c"d|e*f\\g', '.mp3')).toBe('a b c d e f g.mp3');
  });
  it('keeps non-English titles readable', () => {
    expect(sanitizeFilename('こんにちは世界 – الفيديو', '.mp4')).toBe('こんにちは世界 – الفيديو.mp4');
  });
  it('caps the length and never produces an empty or dot-only name', () => {
    expect(sanitizeFilename('x'.repeat(300), '.mp4').length).toBe(84);
    expect(sanitizeFilename('', '.mp4')).toBe('video.mp4');
    expect(sanitizeFilename('...', '.mp4')).toBe('video.mp4');
    expect(sanitizeFilename('..\\..\\etc/passwd', '.mp4')).not.toMatch(/[\\/]/);
  });
  it('strips control characters', () => {
    expect(sanitizeFilename('bad\u0000name\r\n', '.mp4')).toBe('bad name.mp4');
  });
});

describe('contentDisposition', () => {
  it('forces a download and carries an ASCII fallback plus the UTF-8 name', () => {
    const header = contentDisposition('Café – 動画.mp4');
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent('動画'));
  });
  it('cannot be broken out of by quotes in the name', () => {
    const header = contentDisposition('a"b; filename=evil.exe.mp4');
    expect(header.match(/filename="/g)).toHaveLength(1);
    expect(header).not.toContain('"b');
  });
});
