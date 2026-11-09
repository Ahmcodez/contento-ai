# Public video downloader

A free, no-login tool: a visitor pastes a link from YouTube, TikTok, Vimeo, Facebook, Instagram,
X, Dailymotion or Reddit, picks an MP4 quality (up to 1080p) or MP3, and downloads the file. It is
embedded on the home page and has its own pages (`/video-downloader`, `/youtube-video-downloader`,
`/tiktok-video-downloader`, `/vimeo-video-downloader`), plus `/acceptable-use`.

It reuses the URL-import machinery (providers + yt-dlp, see `docs/URL_IMPORT.md`), but everything
public is kept apart from the product: its own queue, its own concurrency, its own limits, and
state in Redis rather than Postgres.

## Read this before turning it on in production

This is the part of the product with the most external risk, and it is mostly not technical.

- **Terms of service.** YouTube, TikTok and others forbid downloading except through their own
  features. A service that offers it can be blocked, can have its hosting suspended, and can get
  cease-and-desist letters. Plenty of these tools exist, but that is not the same as it being safe.
- **Copyright.** Most videos are copyrighted. The tool is neutral, but you operate it. Have a
  lawyer review `/acceptable-use`, and set a real, monitored takedown contact
  (`NEXT_PUBLIC_CONTACT_EMAIL`) before launch. Act on notices with `TOOL_BLOCKLIST`.
- **Hosting and payments.** Some hosts and payment providers restrict this kind of service. Check
  yours.
- **Search.** Google may treat downloader pages harshly. Don't expect, or promise, rankings.
- **Video sites block server IPs.** Datacenter addresses are often refused ("sign in to confirm
  you're not a bot"). Expect failures until you add a proxy (`YTDLP_PROXY`). Cookies from a real
  account (`YTDLP_COOKIES_PATH`) can help but put that account at risk; treat the file as a secret.
  None of this can be verified without real network access, so test on the real host.

## How it works

```
POST /tools/downloader/info   -> lookup (yt-dlp -J), cached 10 min  -> options that really exist
POST /tools/downloader/jobs   -> checks, then queue `tool-download`  -> { id }
   worker: yt-dlp into a temp folder -> verify size (and sound) -> save to storage -> job ready
GET  /tools/downloader/jobs/:id        -> state (page polls every 1.5 s)
GET  /tools/downloader/jobs/:id/file   -> the file, as an attachment, with Range
   sweeper (in the worker): deletes expired files and orphaned temp folders every 5 minutes
```

Job state is a Redis key (`tool:dl:<id>`) with a TTL; the expiry index is a sorted set; a
visitor's running downloads are a set keyed by a hash of their IP. Nothing here touches Postgres.
The API and worker must share storage (they do in `docker-compose.yml`, or use S3).

## Limits and switches (`.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_DOWNLOADER_ENABLED` | `true` | Kill switch; `false` answers 503 |
| `TOOL_MAX_DURATION_SECONDS` | 3600 | Longest video |
| `TOOL_MAX_FILESIZE_MB` | 300 | Largest file (checked after download too) |
| `TOOL_MAX_HEIGHT` | 1080 | Highest quality offered |
| `TOOL_FILE_TTL_SECONDS` | 1800 | How long a ready file lives |
| `TOOL_INFO_PER_MINUTE_PER_IP` | 15 | Lookups per visitor per minute |
| `TOOL_DOWNLOADS_PER_HOUR_PER_IP` | 10 | Downloads one visitor may start per hour |
| `TOOL_MAX_ACTIVE_PER_IP` | 2 | Downloads one visitor may have running at once |
| `TOOL_MAX_QUEUE_DEPTH` | 60 | Waiting downloads before new ones get "busy" |
| `QUEUE_CONCURRENCY_TOOL` | 2 | Downloads running at once, in total |
| `TOOL_BLOCKLIST` | none | Fragments of links to refuse (takedowns), min 6 chars each |
| `YTDLP_PROXY`, `YTDLP_COOKIES_PATH` | none | Network help when sites block the server |

If you change a limit, update the numbers in `frontend/src/lib/downloaderPages.js` too; the page
copy states them (60 minutes, 300 MB, 1080p, 30 minutes).

## What it will and won't do

- Only the listed sites; matched by exact hostname. YouTube Music, direct file links, Dropbox and
  internal addresses are refused.
- One video per link (`--no-playlist`); no live streams; no private, members-only or age-gated
  videos (they need a sign-in).
- MP4 prefers H.264 + AAC so it plays everywhere; a merge that loses the sound is refused.
- Failures are shown to visitors in plain language by reason, never as raw errors.

## SEO pages

`frontend/src/lib/downloaderPages.js` is the single source for the page copy, titles, descriptions,
FAQ and JSON-LD; the sitemap is generated from it. Rules that keep the pages worth indexing:

- Write only what is true of the tool (see the header comment in that file); no "4K", "no
  watermark", "100% safe", speed claims or unsupported sites.
- Each page has its own text. A test in the verification run measures duplicated page-specific
  copy between pages (it was 0%); keep it that way when adding pages.
- Google ended FAQ rich results in 2026 and limits HowTo, so the markup is for understanding, not
  for a display; the value is the content.
- Set `NEXT_PUBLIC_SITE_URL` (canonical URLs, sitemap, structured data) and
  `NEXT_PUBLIC_CONTACT_EMAIL` before launch. The default site URL is a placeholder.

## Tests

`test/publicDownloader*.test.js` (API, worker, storage, cleanup, limits) run against a fake
`yt-dlp` (`test/fixtures/fake-yt-dlp.js`) with a real worker, real ffmpeg and real storage. They
cannot prove a real site still works with yt-dlp; only a run on the real host can.
