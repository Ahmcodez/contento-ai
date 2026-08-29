# Contento AI — Frontend

Next.js (App Router) + Tailwind CSS. Plain JavaScript, no TypeScript.

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL if the backend isn't on localhost:4000
npm run dev
```

The backend (`../backend`) must be running for anything beyond the static
landing page — every authenticated screen calls the real API.

## Design system

- **Palette**: `ink` (dark base), `paper` (light text/bg), `slate` (muted
  text), `line` (borders), `tally` (single restrained accent — named for
  a broadcast tally light, used only for primary actions and live states).
- **Type**: Fraunces (display/headlines), Public Sans (UI/body), IBM Plex
  Mono (timecodes, durations, scores — the real vernacular of every video
  editor). Self-hosted via `@fontsource` — see
  `docs/adr/010-self-hosted-fonts.md`.
- **Signature motif**: a literal timecode ruler (`TimelineRuler`), reused
  in the landing hero and the processing screen's pipeline visual, instead
  of generic numbered-circle steps.

## Structure

```
src/
  app/                     Next.js App Router pages
    page.js                landing page
    (auth)/                login, signup, forgot-password (public)
    (app)/                 dashboard, projects, usage (auth-guarded)
  components/
    ui/                    Button, Card, Badge, Tabs, ProgressBar, etc.
    layout/                nav, footer, authenticated app shell
    marketing/              landing page sections
    upload/                 drag-and-drop upload
    *.js                    feature components (ClipCard, ContentEditor, ...)
  lib/
    api/                    one module per backend route file — see below
    auth/                   AuthContext (session state, silent refresh)
    hooks/                  useJobStatus (polling)
    format.js                timecode/duration/date formatting
```

## API contracts

Every function in `src/lib/api/*.js` maps to a real, tested backend route.
Nothing here is speculative — where the backend was missing an endpoint
this screen needed (transcript, clips, content, usage, nested project/media
data), the endpoint was added and tested on the backend first, not
fabricated on the frontend. See `docs/API.md` for the full contract
reference and the ADRs for the handful of implementation deviations.

**Known gaps — intentionally surfaced in the UI, not faked:**
- No `POST /jobs/:id/retry` — a failed job can't be retried in place; the
  UI says so and points to starting a new upload.
- No `PATCH /clips/:id` or `POST /clips/:id/render` — clip bounds can't be
  manually edited or re-rendered from the UI yet.
- No `GET /content/:id/export` — "export" is implemented as
  copy-to-clipboard, a real working substitute rather than a fake download.
- No password-reset endpoint — the forgot-password page says so directly.

## Polling, not WebSockets

Job status updates via polling (`useJobStatus`), matching
`docs/adr/008-polling-over-websockets-for-status.md`. No new
infrastructure, and it's fine at the latency this pipeline actually runs at.

## Build

```bash
npm run build
```
