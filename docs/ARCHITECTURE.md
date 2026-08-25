# Contento AI — System Architecture

Status: **Design phase — no implementation yet.**
Owner: Principal Architecture doc, versioned alongside the code. Update this
file whenever an architectural decision changes; add an ADR (see
`docs/adr/`) for anything non-trivial.

This document covers system architecture only. Schema detail lives in
`docs/DATABASE.md`, API contracts in `docs/API.md`, queue/job contracts in
`docs/QUEUE.md`, and individual decisions in `docs/adr/*.md`. Read this file
first — it ties the others together.

---

## 1. Guiding constraints (from the brief)

These constraints shaped every decision below, so they're worth stating
explicitly before the design:

- **No premature microservices.** One deployable backend, one deployable
  worker fleet (can literally be the same process in dev), sharing a
  codebase. Split later only when a real bottleneck demands it.
- **No vendor lock-in on AI.** Gemini first, but nothing in business logic
  should import a Gemini SDK type directly.
- **Cost-controlled by default.** Every expensive operation is gated by a
  configurable quota. Nothing should be able to run up an unbounded bill.
- **Async by design.** No HTTP request ever blocks on video processing.
- **Security is not an afterthought.** Ownership checks, input validation,
  and safe FFmpeg invocation are load-bearing, not nice-to-haves.
- **Ship V1 scope only**, but leave clean seams for URL ingestion, social
  publishing, B-roll/avatars, and payments — all deferred, none blocked.

---

## 2. Component overview

```
                              ┌─────────────────────┐
                              │      Frontend        │
                              │  (Next.js, React)    │
                              └──────────┬───────────┘
                                         │ HTTPS (REST + polling/SSE)
                                         ▼
                              ┌─────────────────────┐
                              │      API Server       │
                              │ (Node.js / Fastify)   │
                              │ - Auth (JWT)           │
                              │ - Validation            │
                              │ - Ownership checks       │
                              │ - Rate limiting            │
                              │ - Enqueues jobs              │
                              └───┬────────────┬──────────┘
                                  │            │
                     reads/writes │            │ enqueue job
                                  ▼            ▼
                     ┌─────────────────┐  ┌───────────────┐
                     │   PostgreSQL     │  │  Redis (BullMQ)│
                     │ (system of record)│  │  job queues    │
                     └─────────────────┘  └───────┬────────┘
                                  ▲                │ dequeue
                                  │                ▼
                                  │      ┌───────────────────────┐
                                  │      │   Worker processes      │
                                  └──────┤ - audio extraction (ffmpeg)│
                                         │ - transcription (STT API)   │
                                         │ - AI analysis (Gemini)        │
                                         │ - clip rendering (ffmpeg)        │
                                         │ - content generation (Gemini)      │
                                         └───────┬──────────────────────────┘
                                                 │ reads/writes
                                                 ▼
                                    ┌───────────────────────┐
                                    │   Object Storage         │
                                    │ (local disk in dev /      │
                                    │  S3-compatible in prod)    │
                                    └───────────────────────┘

                 Cross-cutting: structured logging, metrics, config, secrets
```

### 2.1 Frontend
**What**: Next.js (React, TypeScript) SPA/SSR hybrid.
**Why Next.js**: file-based routing keeps the dashboard/project/review
screens organized without hand-rolled routing; SSR gives us fast initial
loads for the dashboard; API routes are *not* used for business logic (that
stays in the backend service) — Next.js is used purely as the frontend
rendering layer to keep a clean client/server boundary.
**Responsibilities**: auth screens, dashboard, project creation, upload UI
with progress, processing status (polling), transcript/clip review and
editing, export. No business logic, no direct DB or storage access — always
through the API.

### 2.2 Backend API
**What**: Node.js + TypeScript, **Fastify** (chosen over Express — see
ADR-002).
**Why**: thin, fast, schema-validated (via JSON Schema/Zod) HTTP layer. Its
only jobs are: authenticate the request, validate input, check ownership,
check quota, do the (cheap, synchronous) work or enqueue a job, and return a
response. It never does heavy media/AI work inline.
**Structure**: layered — `routes → controllers → services → repositories`.
Routes are thin; controllers translate HTTP↔domain; services hold business
logic; repositories are the only layer that touches the DB. This keeps
business logic testable and out of both the UI and the raw SQL.

### 2.3 Authentication
**What**: Email/password (bcrypt/argon2 hashing) + JWT access tokens
(short-lived) with refresh tokens (httpOnly cookie, longer-lived, rotated).
**Why not sessions-in-DB for V1**: JWT keeps the API stateless and simple to
scale horizontally later; refresh-token rotation with a DB-backed revocation
list gives us the security properties of sessions (revocability) without
a lookup on every request. See ADR-001.
**Future-proofing**: the auth service is isolated behind an interface so
OAuth/social login can be added later without touching controllers.

### 2.4 Database — PostgreSQL
**Why Postgres over e.g. Mongo**: the domain is deeply relational (users →
workspaces → projects → media assets → jobs → transcripts → segments →
clips → generated content, all with real foreign keys and cascade rules).
Postgres also gives us `JSONB` for the genuinely flexible bits (AI raw
responses, provider metadata) without giving up relational integrity
everywhere else. Free-tier friendly (Supabase/Neon/Railway all offer free
Postgres) and trivially self-hostable for local dev via Docker.

### 2.5 Object storage
**What**: an abstraction (`StorageDriver`) with two implementations —
`LocalDiskStorageDriver` (dev/test, default) and `S3StorageDriver`
(prod-ready, S3-compatible so Backblaze B2 / Cloudflare R2 / MinIO all work
without code changes). Selected via `STORAGE_DRIVER` env var.
**Why**: raw video files, extracted audio, rendered clips, and thumbnails
are large binary blobs — they do not belong in Postgres. Keeping this
behind an interface from day one avoids a rewrite when moving from local
disk (free) to cloud storage (cheap, but not free) in prod.

### 2.6 Redis
**What**: single Redis instance, used for two distinct purposes that are
logically separated even though they share infrastructure in V1:
1. **BullMQ backing store** — job queues, job state, delayed/retry
   scheduling.
2. **Rate limiting** — sliding-window counters for API abuse prevention.
**Why Redis**: BullMQ requires it; a fixed-window/sliding-window rate
limiter is trivial and fast in Redis; both are free to run locally
(Docker) and cheap on managed free tiers (Upstash free tier is
Redis-compatible and serverless-friendly).

### 2.7 Job queue — BullMQ
**Why BullMQ over e.g. AWS SQS/rolling our own**: it's Redis-based (already
have Redis), has first-class TypeScript support, built-in retry/backoff,
concurrency control per queue, delayed jobs, and a UI (Bull Board) for free
observability into queue state during dev — all without adding cloud
infrastructure. See §6 and `docs/QUEUE.md` for the full job design.

### 2.8 Worker architecture
**What**: a separate Node.js entrypoint (`workers/`) that shares the
`packages/core` domain logic and `packages/ai` / `packages/media` packages
with the API, but runs as its own process(es). In dev, one worker process
handles all queues at low concurrency. In prod, worker count and
per-queue concurrency scale independently of the API.
**Why a separate process, not "just microservices"**: this is *not* a
service split — it's the same monorepo, same domain logic, same DB schema,
deployed as two processes instead of one so a slow video render never
blocks API request handling. This is the minimum viable separation, not a
premature one.

### 2.9 FFmpeg
**What**: invoked via a `MediaProcessor` wrapper around `fluent-ffmpeg` (or
direct `child_process.execFile`, never `exec`/shell string interpolation).
All arguments are built from an allow-listed, typed options object — never
from raw user-controlled strings. See §9.4 for the security model.
**Responsibilities**: probe video metadata (duration, codec, resolution),
extract audio track, cut/crop/reformat clips to 9:16, burn in captions,
generate thumbnails.

### 2.10 Transcription service
**What**: abstracted behind a `TranscriptionProvider` interface, same
pattern as the AI provider. Candidate implementations: a hosted STT API
(e.g. a Gemini audio-capable model, or a dedicated STT API depending on
cost/accuracy tradeoff evaluated at implementation time) or a
self-hosted Whisper (`whisper.cpp` / faster-whisper) for zero marginal
cost in dev.
**Why abstracted separately from the LLM provider**: transcription and
text-generation are different capabilities with different providers and
different cost profiles; coupling them would leak an implementation detail
into business logic.

### 2.11 Gemini / LLM layer
Covered in full in §7. Summary: `AIProvider` interface, Gemini adapter as
first implementation, structured-output-first design, deterministic
fallbacks/validation around every AI call.

### 2.12 Logging
**What**: structured JSON logging (Pino) at the API and worker layer.
Every log line carries a `requestId`/`jobId` correlation field so a
single upload's journey — HTTP request → enqueued job → worker
processing → sub-jobs — can be traced end to end by grepping one ID.
**Why not plain console.log**: structured logs are queryable once shipped
to any log aggregator (even a free-tier one) and let us separate
"useful to a developer" from "useful to a user" (§ error handling in
`docs/PIPELINE.md`).

### 2.13 Monitoring
**V1 (free-tier friendly)**:
- Bull Board (self-hosted, free) for queue/job visibility.
- A `/health` and `/health/ready` endpoint on the API (DB + Redis
  reachability) for uptime checks (e.g. free UptimeRobot).
- Structured logs shippable to a free tier (e.g. Axiom, Better Stack) —
  configurable, optional, off by default in local dev.
**Later**: metrics (Prometheus-style counters: jobs processed, AI calls
made, tokens used, failure rate per stage) exposed on a `/metrics`
endpoint, scraped once real infra exists. Designed for, not built, in V1.

### 2.14 Configuration
**What**: all runtime configuration through environment variables, loaded
once at boot into a validated, typed config object (Zod schema) — the app
fails fast at startup if required config is missing or malformed, rather
than failing confusingly mid-request. No component reads `process.env`
directly outside this one config module.

### 2.15 Deployment (target shape, not built in V1)
- **API**: containerized (Docker), deployable to any container host
  (Fly.io/Railway/Render all have free/cheap tiers) — stateless, scales
  horizontally.
- **Workers**: separate container(s) from the same image (different start
  command), scaled independently based on queue depth.
- **Postgres/Redis**: managed free tiers in dev/staging; managed paid tiers
  in prod. Never self-managed on the same box as the API in prod.
- **Storage**: local disk only for local dev; S3-compatible bucket from
  staging onward.
- **CI**: lint + typecheck + test on every PR (GitHub Actions — free for
  private repos at this scale). No CD to production is designed yet
  (out of scope until there's a production target).

---

## 3. Why this shape and not something else

The single biggest architectural risk in a brief like this is over-building
— e.g. splitting "transcription service", "clip service", and "content
service" into separate deployable microservices with their own databases
from day one. That buys nothing at 10–1,000 users and costs enormously in
operational complexity, network calls replacing function calls, and
distributed-transaction problems for what is fundamentally one coherent
domain. The design instead gets the *benefits* people usually reach for
microservices for — independent scaling of heavy work, isolation of
failure, clear boundaries — via: async job queues (independent scaling
without a network hop), a modular monorepo (clear boundaries without
deployment overhead), and provider abstractions (swappable dependencies
without service boundaries). See §10 for how this evolves as load grows,
and ADR-003 for the explicit microservices-vs-modular-monolith decision.

---

## 4. Monorepo structure

```
contento-ai/
├── apps/
│   ├── api/                     # Fastify HTTP API (deployable unit #1)
│   │   ├── src/
│   │   │   ├── routes/          # thin route definitions per resource
│   │   │   ├── controllers/     # HTTP <-> domain translation
│   │   │   ├── middleware/      # auth, rate-limit, error handler
│   │   │   ├── plugins/         # fastify plugins (db, redis, config)
│   │   │   └── server.ts
│   │   ├── test/
│   │   └── package.json
│   │
│   ├── worker/                  # BullMQ worker processes (deployable unit #2)
│   │   ├── src/
│   │   │   ├── processors/      # one file per job type (video.process, etc.)
│   │   │   ├── index.ts         # worker bootstrap, queue registration
│   │   ├── test/
│   │   └── package.json
│   │
│   └── web/                     # Next.js frontend (deployable unit #3)
│       ├── src/
│       │   ├── app/              # routes: dashboard, projects, review, auth
│       │   ├── components/       # presentational + composed UI
│       │   ├── lib/api-client/   # typed fetch wrappers around the API
│       │   └── styles/
│       ├── test/
│       └── package.json
│
├── packages/
│   ├── core/                    # domain logic shared by api + worker
│   │   ├── src/
│   │   │   ├── entities/        # domain types (not DB models directly)
│   │   │   ├── services/        # business logic (ProjectService, QuotaService...)
│   │   │   └── pipeline/        # state machine definitions (see docs/PIPELINE.md)
│   │
│   ├── db/                      # Postgres schema + repositories (Prisma or Drizzle)
│   │   ├── prisma/schema.prisma (or drizzle/schema.ts)
│   │   ├── migrations/
│   │   └── src/repositories/    # one repository per aggregate root
│   │
│   ├── queue/                   # BullMQ queue/job definitions, shared contracts
│   │   └── src/{queues,jobs,contracts}.ts
│   │
│   ├── ai/                      # AIProvider abstraction + Gemini adapter
│   │   └── src/{AIProvider.ts, providers/gemini/, schemas/}
│   │
│   ├── media/                   # FFmpeg wrapper, safe argument builders
│   │   └── src/{MediaProcessor.ts, ffmpeg/, validators/}
│   │
│   ├── storage/                 # StorageDriver abstraction (local/S3)
│   │   └── src/{StorageDriver.ts, drivers/}
│   │
│   ├── config/                  # env loading + Zod-validated typed config
│   │   └── src/index.ts
│   │
│   ├── logger/                  # Pino instance + correlation-id helpers
│   │   └── src/index.ts
│   │
│   └── shared-types/            # DTOs / API contracts shared by web <-> api
│       └── src/{auth,projects,jobs,clips,content}.ts
│
├── infrastructure/
│   ├── docker/                  # Dockerfiles for api/worker/web, docker-compose.dev.yml
│   ├── ci/                      # GitHub Actions workflows
│   └── env/                     # infra-level env templates (not secrets)
│
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   ├── DATABASE.md
│   ├── API.md
│   ├── PIPELINE.md
│   ├── QUEUE.md
│   ├── AI.md
│   ├── SECURITY.md
│   ├── COST.md
│   ├── SCALABILITY.md
│   ├── SUMMARY.md
│   └── adr/
│       ├── 001-jwt-auth-with-refresh-rotation.md
│       ├── 002-fastify-over-express.md
│       ├── 003-modular-monolith-over-microservices.md
│       ├── 004-bullmq-over-alternatives.md
│       ├── 005-postgres-over-nosql.md
│       ├── 006-ai-provider-abstraction.md
│       ├── 007-storage-driver-abstraction.md
│       └── 008-polling-over-websockets-for-status.md
│
├── .env.example
├── package.json                 # workspaces root (npm/pnpm workspaces + turborepo)
├── turbo.json                   # build/test task graph & caching
└── tsconfig.base.json
```

### Directory responsibilities, explained

- **`apps/*`** — the only things that get *deployed*. Each app is thin: it
  wires together packages, exposes a boot entrypoint, and contains
  transport-layer concerns (HTTP routes, queue processors, React pages).
  No app contains business logic that another app would need to
  duplicate — that always lives in `packages/core`.
- **`packages/core`** — the heart of the domain. Contains the pipeline
  state machine, business services (`ProjectService`, `QuotaService`,
  `ClipScoringService`, etc.), and pure domain entities. This package has
  no knowledge of HTTP or BullMQ — it's imported by both `apps/api` and
  `apps/worker`, which is exactly why the video-processing logic can be
  unit-tested without spinning up a queue.
- **`packages/db`** — the *only* package allowed to import the DB client.
  Exposes repositories (`UserRepository`, `ProjectRepository`,
  `MediaAssetRepository`, ...) with typed methods — nobody outside this
  package writes raw SQL/ORM calls. This is what makes "swap Prisma for
  Drizzle" or "add read replicas later" a contained change.
- **`packages/queue`** — defines queue names, job payload/result contracts
  (TypeScript types), and retry/backoff config in one place, imported by
  both the producer (`apps/api`, enqueuing) and consumer
  (`apps/worker`, processing) so the contract can never drift between them.
- **`packages/ai`** — the `AIProvider` interface and the Gemini
  implementation live here (§7). Nothing outside this package imports
  `@google/generative-ai` directly.
- **`packages/media`** — the FFmpeg wrapper and *only* place that
  constructs FFmpeg argument arrays. Nothing outside this package spawns
  a subprocess.
- **`packages/storage`** — `StorageDriver` interface + local/S3
  implementations. Nothing outside this package touches the filesystem or
  an S3 SDK directly for user media.
- **`packages/config`** — one validated config object, computed once,
  imported everywhere config is needed. No `process.env` access outside
  this package (enforced by lint rule once implementation starts).
- **`packages/shared-types`** — DTOs shared between `apps/web` and
  `apps/api` so the frontend and backend can never silently drift on a
  request/response shape; this is what "typed API contracts where
  practical" (brief, Code Quality section) means concretely.
- **`infrastructure/`** — anything about *running* the system that isn't
  application code: Dockerfiles, docker-compose for local dev (Postgres +
  Redis + MinIO, all free/local), CI workflows.
- **`docs/`** — this document set. Kept in the repo, versioned with the
  code, reviewed in PRs like code.

### Tooling choice: npm/pnpm workspaces + Turborepo
**Why**: Turborepo gives task caching and a dependency-aware build/test
graph across `apps/*` and `packages/*` without the operational overhead of
Nx's more opinionated plugin system, and it's free. pnpm workspaces (or npm
workspaces, decided at implementation time based on team familiarity) keep
node_modules deduplicated across packages. See ADR (to be added at
implementation time if this needs revisiting) — this is a low-risk,
easily-reversible choice, so it doesn't warrant a full ADR here.
