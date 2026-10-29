# API Design

Base path: `/api/v1`. JSON in, JSON out. Auth via `Authorization: Bearer
<accessToken>` unless noted. All authenticated endpoints additionally
enforce **ownership** (resource belongs to a workspace the caller is a
member of) and **quota** where relevant — both explicit, testable
middleware/service calls, not implicit.

Standard error shape (all endpoints):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "human-readable", "details": { } } }
```
Standard pagination (list endpoints): `?page=1&pageSize=20`, response
includes `{ "data": [...], "pagination": { "page", "pageSize", "total" } }`.

---

## Authentication

### `POST /api/v1/auth/register`
- Auth: none.
- Request: `{ email, password, name }`.
- Response `201`: `{ user: {id,email,name}, accessToken }` + refresh token set as httpOnly cookie.
- Errors: `409 EMAIL_TAKEN`, `422 VALIDATION_ERROR` (weak password, invalid email).

### `POST /api/v1/auth/login`
- Auth: none.
- Request: `{ email, password }`.
- Response `200`: `{ user, accessToken }` + refresh cookie set.
- Errors: `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`.

### `POST /api/v1/auth/refresh`
- Auth: refresh cookie (httpOnly, not bearer).
- Response `200`: `{ accessToken }`, rotates refresh cookie.
- Errors: `401 INVALID_REFRESH_TOKEN`.

### `POST /api/v1/auth/logout`
- Auth: bearer.
- Response `204`. Revokes refresh token server-side.

### `GET /api/v1/auth/me`
- Auth: bearer.
- Response `200`: `{ user, workspace: { id, name } }`.

---

## Projects

### `GET /api/v1/projects`
- Auth: bearer. Scoped to caller's workspace(s).
- Query: `page, pageSize, status`.
- Response `200`: paginated `Project[]` with a lightweight `latestJobStatus` summary per project.

### `POST /api/v1/projects`
- Auth: bearer.
- Request: `{ title, description? }`.
- Response `201`: `Project`.
- Errors: `422 VALIDATION_ERROR`.

### `GET /api/v1/projects/:projectId`
- Auth: bearer + ownership.
- Response `200`: `Project` with nested `mediaAssets: [{id, status, latestJob}]`.
- Errors: `404 NOT_FOUND` (also returned, not `403`, if it exists but caller lacks access — avoids leaking existence; see `docs/SECURITY.md`).

### `PATCH /api/v1/projects/:projectId`
- Auth: bearer + ownership.
- Request: `{ title?, description?, status? }`.
- Response `200`: updated `Project`.

### `DELETE /api/v1/projects/:projectId`
- Auth: bearer + ownership (role ≥ editor).
- Response `204`. Archives (soft-delete), see `docs/DATABASE.md`.

---

## Uploads

### `POST /api/v1/projects/:projectId/media`
- Auth: bearer + ownership + quota check (`max_concurrent_jobs`, plan-based upload size/duration limits enforced post-upload at validation stage).
- Request: `multipart/form-data`, single file field `video` plus an optional text field `clipCount` (whole number, `1` to `MAX_CLIPS_PER_VIDEO`; default `DEFAULT_CLIPS_PER_VIDEO`), streamed directly to the `StorageDriver` (not buffered fully in memory) with size capped at the transport layer before app-level checks even run.
- Response `202`: `{ mediaAsset: {id, status: "uploading"}, processingJob: {id, state: "UPLOADING"} }` — job created immediately so the client can start polling before the upload even finishes.
- Errors: `413 FILE_TOO_LARGE` (transport-level pre-check), `415 UNSUPPORTED_MEDIA_TYPE`, `429 QUOTA_EXCEEDED` (`{ code, message, quota: {...} }`), `422 VALIDATION_ERROR`, `422 INVALID_CLIP_COUNT` (nothing is created).

### `GET /api/v1/media/:mediaAssetId`
- Auth: bearer + ownership.
- Response `200`: `MediaAsset` including `status`, `rejectionReason?`, `durationSeconds?`.

---

## Processing jobs

### `GET /api/v1/jobs/:jobId`
- Auth: bearer + ownership (via media asset → project → workspace).
- Response `200`: `{ id, state, stateGroup, progressPercent, failureStage?, errorMessage?, createdAt, startedAt?, completedAt? }` — this is the primary polling endpoint (see ADR-008 on polling vs WebSockets).
- Errors: `404 NOT_FOUND`.

### `GET /api/v1/jobs/:jobId/events`
- Auth: bearer + ownership.
- Response `200`: `ProcessingJobEvent[]` — full state history, for a "processing timeline" UI and support/debugging.

### `POST /api/v1/jobs/:jobId/cancel`
- Auth: bearer + ownership.
- Response `200`: `{ id, state: "CANCELLED" }`.
- Errors: `409 ALREADY_TERMINAL` if job already completed/failed/cancelled.

### `POST /api/v1/jobs/:jobId/retry`
- Auth: bearer + ownership.
- Only valid if `state === FAILED`. Resumes from the stage the job failed in (taken from its last `FAILED` event), not from scratch, so work already done is reused and not paid for again. Failure fields are cleared and a `retry: true` event is recorded.
- Response `202`: the updated job, same shape as `GET /jobs/:jobId`.
- Errors: `409 NOT_RETRYABLE` if the job is not `FAILED`, if its media was rejected at validation (too long, no audio, over quota), or if the failing stage can't be determined; `429 QUOTA_EXCEEDED` if the user is already at their concurrent-job limit; `404` if not found or not yours. Simultaneous retries are safe: only one wins, the rest get `409`.

---

## Transcript

### `GET /api/v1/jobs/:jobId/transcript`
- Auth: bearer + ownership.
- Response `200`: `{ fullText, language, segments: [{id, startMs, endMs, text, speakerLabel?}] }`.
- Errors: `404 NOT_FOUND` (not yet transcribed or job doesn't exist), `409 NOT_READY` if job hasn't reached `TRANSCRIBED` yet.

---

## Clips

### `GET /api/v1/jobs/:jobId/clips`
- Auth: bearer + ownership.
- Response `200`: `ClipCandidate[]` with nested `generatedClip?: {storageUrl, thumbnailUrl, durationSeconds, renderStatus}`, ordered by `rank`.

### `GET /api/v1/clips/:clipCandidateId`
- Auth: bearer + ownership.
- Response `200`: single clip detail, including `rationale`, `startMs/endMs` for the preview player to seek the source video.

### `PATCH /api/v1/clips/:clipCandidateId`
- Auth: bearer + ownership.
- Request: `{ startMs?, endMs?, title? }` — user manually adjusts clip bounds.
- Response `200`: updated `ClipCandidate`, `status` reset to allow re-render.
- Errors: `422 VALIDATION_ERROR` (out of bounds, exceeds max clip length).

### `POST /api/v1/clips/:clipCandidateId/render`
- Auth: bearer + ownership + quota check (counts toward `max_clips_per_video` if this is a net-new render vs a re-render of an edited clip).
- Enqueues a `clip.render` job for this single clip (used both for initial auto-render and for re-rendering after a manual edit).
- Response `202`: `{ generatedClip: {id, renderStatus: "pending"} }`.

### `POST /api/v1/clips/:clipCandidateId/playback`
- Auth: bearer + ownership. For in-app playback: a `<video>` can't send an `Authorization` header, so the app asks here, then loads the returned links directly.
- Response `200`: `{ streamUrl, posterUrl | null, expiresAt }` (paths under the API origin). Links are signed (HMAC), bound to this clip and to one purpose (video or poster), and expire after `PLAYBACK_URL_TTL_SECONDS` (default 3600).
- Errors: `404 NOT_FOUND`, `409 NOT_RENDERED`.

### `GET /api/v1/clips/:clipCandidateId/stream?t=<token>`
- Auth: the signed `t` token only (no bearer header). Supports `Range` (`206` partial content, `416` with `Content-Range: bytes */size` if out of range, `Accept-Ranges: bytes`), `HEAD`, and sends `Cross-Origin-Resource-Policy: cross-origin` so the app's page can load it.
- Errors: `403 INVALID_PLAYBACK_LINK` (missing, malformed, tampered, expired, or for another clip/purpose), `404` (file missing), `409 NOT_RENDERED`.

### `GET /api/v1/clips/:clipCandidateId/thumbnail?t=<token>`
- Same signed-link rules; serves the clip's poster image (`image/jpeg`).

### `GET /api/v1/clips/:clipCandidateId/download`
- Auth: bearer + ownership.
- Response `200`: short-lived signed URL (or streamed file in local-disk dev mode) — never a raw public storage path.
- Errors: `409 NOT_RENDERED`.

---

## Generated content

### `GET /api/v1/jobs/:jobId/content`
- Auth: bearer + ownership.
- Response `200`: `GeneratedContent[]`, one per `contentType`.

### `PATCH /api/v1/content/:contentId`
- Auth: bearer + ownership.
- Request: `{ body }` — user edits generated text.
- Response `200`: updated content, `status: "edited"`.

### `POST /api/v1/jobs/:jobId/content/:contentType/regenerate`
- Auth: bearer + ownership + quota check (`max_ai_requests_per_day`).
- Response `202`: re-enqueues a single `content.generate` sub-job for that type only.
- Errors: `429 QUOTA_EXCEEDED`.

### `GET /api/v1/content/:contentId/export`
- Auth: bearer + ownership.
- Query: `?format=txt|md` (V1 — no platform auto-publishing, brief explicitly excludes it).
- Response `200`: file stream / plain text, `Content-Disposition: attachment`.

---

## Usage

### `GET /api/v1/usage`
- Auth: bearer.
- Response `200`: `{ plan, quota: {...limits}, usage: { uploadMinutesUsed, aiRequestsUsedToday, clipsRenderedThisMonth, ... }, resetAt }`.
- Purpose: powers a usage dashboard widget and lets the frontend proactively disable actions (e.g. grey out "upload" button) before hitting a 429.

---

## Cross-cutting API rules
- **Rate limiting**: applied per-user (authenticated) or per-IP
  (unauthenticated auth endpoints) via the Redis sliding-window limiter,
  configurable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`.
  Auth endpoints (`/login`, `/register`) have a stricter, separate limit to
  blunt credential-stuffing attempts.
- **Ownership checks are never skipped** — every `:id`-scoped route
  resolves the resource through a repository method that takes the
  authenticated `userId`/`workspaceId` as a required parameter, so it's
  structurally impossible to write a handler that forgets the check (see
  `docs/SECURITY.md`).
- **Idempotency for enqueue-triggering endpoints**: `POST` endpoints that
  enqueue a job (upload, render, regenerate) accept an optional
  `Idempotency-Key` header; if a request with the same key was already
  processed for that resource, the prior result is returned instead of
  enqueuing a duplicate job.
