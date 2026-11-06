#!/usr/bin/env node
/*
 * A stand-in for the yt-dlp binary, for tests that need to run the real download pipeline
 * (HTTP -> queue -> worker -> ffmpeg -> storage) without network access. It speaks the parts of
 * yt-dlp's interface this app uses: `-J` for metadata, and a download that writes a real media
 * file to the `-o` template and prints its path for `--print after_move:filepath`.
 *
 * The URL picks the scenario ("long", "live", "private", "fail", "noaudio", "slow"). Every
 * invocation's arguments are appended to <tmpdir>/fake-yt-dlp.log so tests can assert on exactly what
 * the app asked yt-dlp to do.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Jest hands tests their own copy of process.env, so a variable set in a test never reaches a child
// process; the log lives at a fixed, shared path instead.
const LOG = path.join(os.tmpdir(), 'fake-yt-dlp.log');

const args = process.argv.slice(2);
fs.appendFileSync(LOG, `${JSON.stringify(args)}\n`);

const url = args[args.length - 1];
const SAMPLE = path.join(__dirname, 'sample.mp4');
const fail = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
};

if (/private/.test(url)) fail('ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access to this video');

if (args.includes('-J')) {
  const video = (height) => ({ format_id: `v${height}`, vcodec: 'avc1', acodec: 'none', height, width: Math.round((height * 16) / 9), filesize: height * 20000 });
  const info = {
    id: 'abc123',
    title: 'Test: Video / Name?',
    uploader: 'Test Channel',
    thumbnail: 'https://i.ytimg.com/vi/abc123/hq.jpg',
    duration: /long/.test(url) ? 7200 : 120,
    is_live: /live/.test(url),
    formats: [
      ...[144, 360, 720, 1080, 2160].map(video),
      { format_id: 'a1', vcodec: 'none', acodec: 'mp4a', filesize: 900000 },
    ],
  };
  process.stdout.write(JSON.stringify(info));
  process.exit(0);
}

// ---- a download
if (/fail/.test(url)) fail('ERROR: Unable to download webpage: something unexpected happened');
if (/slow/.test(url)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);

const template = args[args.indexOf('-o') + 1];
const audio = args.includes('-x');
const out = template.replace('%(ext)s', audio ? 'mp3' : 'mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });

if (audio) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', SAMPLE, '-vn', '-c:a', 'libmp3lame', out]);
} else if (/noaudio/.test(url)) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', SAMPLE, '-an', '-c:v', 'copy', out]);
} else {
  fs.copyFileSync(SAMPLE, out);
}
process.stdout.write(`${out}\n`);
