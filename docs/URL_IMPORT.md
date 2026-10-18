# URL import ("Paste Video URL")

Lets a user paste a link instead of uploading a file. It is a short pre-pipeline
flow with its own state machine (`media_imports`); once the file is downloaded it
joins the exact same `media_assets` -> `processing_jobs` pipeline an upload does,
and nothing downstream knows or cares where the file came from.

## Flow

```
POST /projects/:id/media/url       (create; returns immediately)
  DETECTING_PROVIDER   pick a provider from the URL (no network)
  FETCHING_METADATA    title / thumbnail / duration preview, nothing downloaded yet
  WAITING_CONFIRMATION user reviews the preview
POST /media-imports/:id/confirm    (quota checks, then enqueue download)
  DOWNLOADING          provider.download() to local tmp, size-capped
  VALIDATING_MEDIA     hand-off to createMediaAssetFromLocalFile (same as upload)
  COMPLETED            media_asset + processing_job created, pipeline starts
FAILED                 from any stage, with a user-facing error_message
```

Polling: `GET /media-imports/:id`. Queue stages: `url-import.resolve` (light queue)
and `url-import.download` (its own queue, up to 15 minutes, disk + untrusted
network). See `docs/QUEUE.md`.

Cost-protection order is deliberate: metadata -> duration cap -> quota check ->
**user confirmation** -> download. Nothing expensive happens before the user says go.

## Providers

`src/providers/`. Each implements `URLProvider` (`name`, `canHandle`,
`getMetadata`, `download`). `ProviderResolver.js` checks them in order and the
first `canHandle` wins:

| Provider | Matches | Backed by |
|---|---|---|
| `YouTubeProvider` | strict YouTube hostname allowlist | yt-dlp |
| `VimeoProvider` | Vimeo hostnames | yt-dlp |
| `TikTokProvider` | TikTok hostnames | yt-dlp |
| `DropboxProvider` | Dropbox share links | yt-dlp |
| `DirectMediaProvider` | direct `.mp4 .mov .mkv .webm` links (fallback, checked last) | Node HTTP via `ssrfSafeFetch` |

Adding a source = a class implementing `URLProvider` plus one line in
`PROVIDERS`. Nothing else (service, controller, queue, processors) branches on
provider. Errors that retrying can't fix (private video, unsupported URL, DRM)
are thrown as `ProviderError` with `retryable: false` and fail the import
immediately instead of burning BullMQ retries.

## yt-dlp

A separate binary, **not** an npm dependency. `YTDLP_PATH` (default `yt-dlp`).
The backend Docker image installs the standalone release binary (x86 or ARM) and
runs `yt-dlp --version` at build time; locally use `pip install yt-dlp` or the
release binary. YouTube changes often and old yt-dlp versions stop working, so
**update it regularly** (rebuild the image, or `yt-dlp -U`). The worker logs a
warning at startup if it, `ffmpeg` or `ffprobe` isn't reachable.

Things learned the hard way (each was a real production bug):

- **ffmpeg location.** `yt-dlp --ffmpeg-location` does not search `PATH` the way
  this app's own ffmpeg calls do, so the app resolves it to an absolute path
  first (`resolveFfmpegLocation.js`). Keep `FFMPEG_PATH` and `FFPROBE_PATH` in the
  same directory.
- **Huge metadata.** Videos with many caption languages made `-J` output exceed
  Node's `execFile` stdout buffer. Fixed at the source with
  `--extractor-args youtube:skip=translated_subs`, plus a safety ceiling
  (`YTDLP_METADATA_MAX_BUFFER_MB`, default 50).
- Downloads always pass `--no-playlist` (a playlist/channel URL never expands
  into hundreds of videos) and `--max-filesize`. The final file path is read from
  yt-dlp's own `--print after_move:filepath` and then verified rather than guessed.

## Security

- **SSRF (direct links):** requests this process makes go through
  `src/security/ssrfSafeFetch.js`: DNS is resolved and checked first (loopback,
  private, link-local, carrier-grade NAT, cloud-metadata ranges rejected), the
  connection is pinned to that exact validated IP (so DNS rebinding can't swap it
  after the check), and every redirect hop is re-validated from scratch, up to a
  fixed limit.
- **SSRF (yt-dlp providers):** yt-dlp makes its own network calls inside a
  subprocess, so `ssrfSafeFetch` does not cover them. The safeguard there is the
  strict hostname allowlist each provider uses to match a URL (never a substring
  check), so only the named sites ever reach yt-dlp.
- **Size and duration:** `--max-filesize` / `maxBytes` (`MAX_UPLOAD_SIZE_MB`) on
  every download; hard duration cap `MAX_VIDEO_DURATION_SECONDS` (4 hours) is
  enforced at preview time, before any download.
- **Trust:** a downloaded file is treated like an untrusted upload: content
  sniffed, ffprobe'd, checksum-deduped. Nothing the provider reports is trusted.
- **Abuse:** URL-import creation has its own rate limiter (see `media.routes.js`).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `YTDLP_PATH` | `yt-dlp` | Binary to run |
| `YTDLP_METADATA_TIMEOUT_MS` | 20000 | Preview fetch ceiling |
| `YTDLP_DOWNLOAD_TIMEOUT_MS` | 900000 | Download ceiling (15 min) |
| `YTDLP_METADATA_MAX_BUFFER_MB` | 50 | stdout buffer safety net |
| `MAX_VIDEO_DURATION_SECONDS` | 14400 | Longest video accepted |
| `MAX_UPLOAD_SIZE_MB` | 500 | Largest file accepted |

## Failure and recovery

Expected failures (bad URL, private video, too long, too big, ffmpeg missing) set
`FAILED` with a readable message. Anything unexpected that exhausts BullMQ retries
is caught by `wrapWithErrorPersistence`, so an import can't stay stuck silently.
An import whose queue job is lost (crash, Redis flush) is re-enqueued, or failed
after a bounded number of tries, by the stuck-job reaper
(`docs/STUCK_JOB_REAPER.md`); `WAITING_CONFIRMATION` is waiting on the user and is
left alone.
