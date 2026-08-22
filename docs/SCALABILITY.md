# Scalability: 10 → 10,000 users, without premature microservices

The core claim: the modular-monolith-plus-queue shape (§ ARCHITECTURE.md
§3, ADR-003) absorbs roughly three orders of magnitude of growth through
**configuration and horizontal scaling of existing components**, not
through re-architecture. Re-architecture (if ever needed) becomes a
deliberate, evidence-driven decision made *after* real bottleneck data
exists — not a guess made today.

## 10 users
- Single API instance, single worker process (all queues, low
  concurrency), free-tier Postgres + Redis, local or free-tier object
  storage. Everything in `docs/COST.md` §1 applies as-is. This is
  literally the dev environment, possibly deployed to a single free/cheap
  container host for a closed beta.
- **Bottleneck at this scale**: none, functionally. The design goal here
  is correctness and cost, not throughput.

## 100 users
- API: still a single instance is likely fine (Fastify handles this
  comfortably), but this is the point to add a second instance behind a
  load balancer if uptime during deploys matters — trivial since the API
  is already stateless (JWT auth, no sticky sessions needed).
- Worker: split into **multiple worker processes by queue group** — e.g.
  one process handling `video-validate`/`audio-extract`/`clip-render`
  (CPU-bound), another handling `transcription-process`/`content-analyze`/
  `clips-detect`/`content-generate` (I/O-bound, external-API-bound). This
  is a deployment/config change (different start command, same codebase),
  not a service split.
- Postgres/Redis: move from free tier to a small managed paid tier if free
  tier limits are hit (connection count, storage). Still one Postgres
  instance, no read replicas needed yet.
- **Bottleneck to watch**: transcription/AI queue concurrency — this is
  where per-queue concurrency tuning (`docs/QUEUE.md` §5) starts to
  matter, and where quota tuning (`docs/COST.md`) protects the budget as
  real usage (not just dev testing) begins.

## 1,000 users
- API: horizontally scaled (N stateless instances behind a load balancer),
  autoscaled on CPU/request count.
- Worker: horizontally scaled *per queue group*, each independently
  scaled/autoscaled based on **queue depth** (BullMQ exposes this
  natively) rather than a fixed instance count — e.g. `clip-render`
  workers scale with render backlog, `transcription-process` workers scale
  more conservatively since they're bound by external API rate limits
  regardless of worker count.
- Postgres: add a **read replica** for read-heavy endpoints (dashboard
  listing, usage queries) if write-path contention appears; the
  repository-layer abstraction (`packages/db`) makes routing specific
  reads to a replica a contained change. Add the `usage_records` daily
  rollup mentioned in `docs/COST.md` §3 if quota-check queries start
  showing up in slow-query logs.
- Redis: still one instance is likely sufficient (BullMQ + rate limiting
  load at 1,000 users is modest); if not, split into two Redis
  instances — one for BullMQ, one for rate-limiting — since they were
  already logically separated (`docs/ARCHITECTURE.md` §2.6) even though
  they shared infrastructure at smaller scale.
- Storage: fully on S3-compatible cloud storage by this point (already the
  case from staging onward per `docs/ARCHITECTURE.md` §2.16), with a CDN
  in front of clip/thumbnail delivery.
- **This is the point where per-stage cost data (§ `docs/COST.md` §6
  usage ledger) becomes genuinely valuable** — real usage patterns inform
  whether e.g. self-hosted transcription infrastructure (a dedicated GPU
  worker pool for Whisper) becomes cheaper than a hosted STT API at this
  volume. That's a data-driven decision enabled by the
  `TranscriptionProvider` abstraction, not a rewrite.

## 10,000 users
- This is the scale where **splitting the worker fleet into genuinely
  separate deployable services** (not just process groups) starts to have
  a real argument: the CPU-bound render fleet and the I/O-bound AI/
  transcription fleet have different scaling curves, different failure
  modes, and potentially different hosting requirements (e.g. GPU
  instances for self-hosted transcription/rendering acceleration). Even
  here, this is a **deployment topology change**, not a rewrite — because
  `packages/core`, `packages/queue`, `packages/ai`, `packages/media` were
  already independent packages with clean boundaries from day one. The
  "service split" at this stage is: point two different deployment
  pipelines at two different subsets of `apps/worker`'s processors,
  sharing the same `packages/*`.
- Database: this is plausibly where a genuine multi-database split (e.g.
  separating the high-write `usage_records`/`processing_job_events`
  append-only ledgers from the core relational schema, or moving them to
  a purpose-built time-series/analytics store) starts to pay for itself —
  again, a decision made from real data, not speculated today.
- API: likely multiple regions/edge deployment if the user base is
  geographically distributed; introduces genuinely new concerns (data
  residency, cross-region DB latency) that are explicitly **out of scope
  to design today** — flagged here so it's not a surprise later, not
  solved prematurely.
- Object storage/CDN: this was already solved at the 1,000-user stage and
  just scales further.

## What does *not* change across this entire curve
- The domain model (`docs/DATABASE.md`).
- The pipeline state machine (`docs/PIPELINE.md`).
- The `AIProvider` / `StorageDriver` / `TranscriptionProvider`
  abstractions (`docs/AI.md`, `docs/ARCHITECTURE.md`).
- The API contract shape (`docs/API.md`) — versioned (`/api/v1`) so it can
  evolve without breaking existing clients if it ever needs to.
- The monorepo package boundaries (`docs/ARCHITECTURE.md` §4) — these are
  exactly the seams along which any future service split would occur,
  which is *why* they were drawn this way from the start rather than
  drawn reactively under pressure at 10,000 users.
