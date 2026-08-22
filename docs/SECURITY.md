# Security Architecture

## 1. Authentication
- Passwords hashed with argon2id (or bcrypt with a strong cost factor — final
  choice at implementation time; argon2id preferred).
- Access tokens: short-lived JWT (e.g. 15 min), signed with `JWT_SECRET`
  (env, never committed — see `.env.example`).
- Refresh tokens: longer-lived, stored httpOnly+secure+sameSite cookie,
  **rotated on every use** and tracked in a DB revocation table so a
  stolen refresh token has a small blast radius and can be invalidated.
- Rate-limited login/register endpoints specifically (tighter than general
  API rate limits) to blunt credential stuffing / brute force.

## 2. Authorization / ownership
- Every resource access resolves through the workspace-membership chain:
  `MediaAsset → Project → Workspace → WorkspaceMember(userId)`. Repository
  methods that fetch a scoped resource **require** the caller's
  `userId`/`workspaceId` as a parameter — there is no "fetch by ID alone"
  method available to route handlers for owned resources, which makes
  forgetting the check a compile-time-visible gap, not a silent runtime
  hole.
- **404, not 403, on unauthorized access to an existing resource** —
  returning 403 confirms the resource exists (an enumeration/info leak);
  404 does not. Documented explicitly in `docs/API.md`.
- Role model (`owner`/`editor`/`viewer` on `WorkspaceMember`) is modeled in
  the schema now even though V1 only exercises `owner`, so permission
  checks are written against roles from day one rather than retrofitted
  when multi-seat workspaces ship.

## 3. File / upload security
- **Type validation is never trust-the-extension or trust-the-header**:
  the API validates the `Content-Type` header as a first pass, but the
  worker's `video.validate` stage re-verifies via magic-byte sniffing
  (actual file signature) and `ffprobe` — a renamed `.exe` with a `.mp4`
  extension is rejected at the deterministic-validation stage regardless
  of what the client claimed.
- **Size/duration limits enforced server-side twice**: once at the
  transport layer (reject the upload stream early once it exceeds
  `MAX_UPLOAD_SIZE_MB`, don't buffer an oversized file fully before
  checking) and again after `ffprobe` reports true duration (a client
  can't lie about duration to bypass the limit).
- **Storage keys are opaque, server-generated** (`{workspaceId}/{projectId}/{mediaAssetId}/original.<ext>`)
  — never derived from user-supplied filenames, which eliminates path
  traversal (`../../etc/passwd`-style) by construction. The original
  filename is stored as metadata for display only, sanitized before even
  that.
- **No public storage URLs** in local-disk dev mode; the API streams files
  through an authenticated, ownership-checked endpoint. In S3-backed
  environments, only short-lived signed URLs are issued, never permanent
  public links.

## 4. FFmpeg security
- **No shell string interpolation, ever.** All FFmpeg invocations go
  through `child_process.execFile` (or the FFmpeg wrapper library's
  equivalent), which passes arguments as an array — there is no shell
  parsing step for an attacker-controlled value to break out of.
- **Argument allow-listing**: `packages/media`'s `MediaProcessor` exposes
  typed methods (`extractAudio(input, options)`, `renderClip(input,
  {startMs, endMs, aspectRatio})`, etc.) that internally build the FFmpeg
  arg array from a fixed, known set of flags. There is no code path that
  accepts a raw user-supplied FFmpeg argument string.
- **Numeric/timestamp inputs are validated and clamped** before being
  passed to FFmpeg (e.g. `startMs`/`endMs` bounds-checked against the
  actual media duration) — both because AI-proposed values shouldn't be
  trusted (`docs/AI.md` §1) and because user-edited clip bounds
  (`PATCH /api/v1/clips/:id`) come from client input.
- **Resource limits on FFmpeg processes**: timeouts on every invocation
  (a hung/malicious input can't tie up a worker indefinitely), and
  worker-level concurrency caps (`docs/QUEUE.md`) bound total concurrent
  FFmpeg processes per host.
- **Input isolation**: FFmpeg reads only from the specific storage key
  resolved by the job's own `mediaAssetId` — the worker process has no
  general filesystem access pattern that a crafted input could exploit to
  reach arbitrary paths.

## 5. API rate limiting
- Redis-backed sliding window, per-authenticated-user for most endpoints,
  per-IP for unauthenticated endpoints (`/auth/login`, `/auth/register`).
- Configurable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`.
- Separate, stricter limits on auth endpoints and on upload initiation
  (uploads are inherently more expensive to accept than a typical GET).

## 6. Secrets
- All secrets via environment variables, loaded and validated once at
  boot by `packages/config` (Zod schema — missing/malformed required
  secret fails startup immediately, not mid-request).
- `.env.example` documents every required key with **no real values**;
  `.env` is gitignored (already committed as part of the initial scaffold).
- No secret is ever logged — the structured logger has a redaction list
  (`password`, `token`, `apiKey`, `secret`, etc. field-name patterns)
  applied to every log call as a safety net, not just discipline.
- CI secrets (if/when CD is added) live in GitHub Actions secrets, never
  in the repo.

## 7. Data isolation
- Every DB query that touches project-scoped data is filtered by
  `workspace_id` (directly or via join) at the repository layer — see §2.
  This is the app-enforced multi-tenancy boundary for V1 (see
  `docs/DATABASE.md` note on RLS as a future option).
- Object storage keys are namespaced by `workspaceId`/`projectId` (§3),
  giving a second, independent isolation boundary at the storage layer —
  even a bug in DB-layer scoping wouldn't automatically grant filesystem/
  bucket access across tenants, since the storage key itself isn't
  guessable from another tenant's context without already having the
  correct `mediaAssetId`, which is itself gated by the DB-layer check.

## 8. Abuse prevention
- Per-user concurrent job limits (`MAX_PROCESSING_JOBS_PER_USER_CONCURRENT`)
  prevent one account from monopolizing worker capacity.
- Quota system (`docs/COST.md`) is itself an abuse-prevention mechanism,
  not just a cost control — it caps how much of any resource (uploads, AI
  calls, storage) one account can consume regardless of intent.
- Idempotency keys on job-enqueuing endpoints prevent duplicate-submission
  abuse (accidental or scripted double-clicks/retries) from creating
  redundant paid work.
- Structured logging with correlation IDs makes it feasible to detect and
  investigate abuse patterns (e.g. one IP hitting `/register` repeatedly)
  even before a dedicated abuse-detection system exists.
