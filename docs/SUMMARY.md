# Architecture Summary

This is the consolidated view. Full detail lives in the linked docs — this
page is the map, not the territory.

- System design & rationale: `docs/ARCHITECTURE.md`
- Database schema: `docs/DATABASE.md`
- Processing pipeline state machine: `docs/PIPELINE.md`
- REST API: `docs/API.md`
- Queue/job design: `docs/QUEUE.md`
- AI provider architecture: `docs/AI.md`
- Cost architecture: `docs/COST.md`
- Security architecture: `docs/SECURITY.md`
- Scalability path: `docs/SCALABILITY.md`
- Decision records: `docs/adr/`

---

## 1. Final architecture diagram

```
┌────────────┐        HTTPS         ┌──────────────────────────┐
│  Frontend    │ ───────────────────▶ │        API (Fastify)       │
│  (Next.js)   │ ◀─────────────────── │  auth · validation · quota  │
└────────────┘      poll status      │  ownership · rate limit      │
                                     └───────┬──────────┬───────────┘
                                            │          │
                                  reads/writes│          │enqueue
                                            ▼          ▼
                                ┌─────────────────┐ ┌────────────────┐
                                │   PostgreSQL      │ │ Redis (BullMQ)   │
                                │ system of record   │ │ queues + rate    │
                                │                      │ │ limiting          │
                                └─────────────────┘ └───────┬────────┘
                                            ▲                 │ dequeue
                                            │                 ▼
                                            │      ┌───────────────────────┐
                                            └──────┤  Worker (apps/worker)   │
                                                   │  processors per queue     │
                                                   │  packages/{core,ai,media,  │
                                                   │  storage,queue,db} shared  │
                                                   └───────┬───────────────────┘
                                                          │
                                     ┌─────────────────────┼─────────────────────┐
                                     ▼                     ▼                     ▼
                           ┌────────────────┐   ┌───────────────────┐  ┌──────────────────┐
                           │  Object storage  │   │  Transcription      │  │  Gemini (LLM)      │
                           │ (local disk dev /  │   │  provider             │  │  via AIProvider      │
                           │  S3-compatible prod) │   │ (local Whisper dev /  │  │  abstraction           │
                           └────────────────┘   │  hosted API prod)     │  └──────────────────┘
                                                └───────────────────┘
```

## 2. Repository structure (see `docs/ARCHITECTURE.md` §4 for full detail)

```
contento-ai/
├── apps/{api, worker, web}
├── packages/{core, db, queue, ai, media, storage, config, logger, shared-types}
├── infrastructure/{docker, ci, env}
└── docs/{ARCHITECTURE, DATABASE, API, PIPELINE, QUEUE, AI, SECURITY,
         COST, SCALABILITY, SUMMARY}.md + adr/
```

## 3. Database ER diagram (description — see `docs/DATABASE.md` for full field-level detail)

```
User ─┬─< WorkspaceMember >─┬─ Workspace ─< Project ─< MediaAsset ─< ProcessingJob
      │                     │                                            │
      └─< UsageRecord       │                                            ├─< ProcessingJobEvent
                            │                                            ├─1 Transcript ─< TranscriptSegment
                            (owner_id on Workspace)                       ├─1 ContentAnalysis
                                                                          ├─< ClipCandidate ─1 GeneratedClip
                                                                          ├─< GeneratedContent
                                                                          └─< ProcessingError

Quota: keyed by plan (free/pro), referenced by User.plan — not a per-row FK relationship.
```
Key relational facts: every `Project` belongs to exactly one `Workspace`
(never directly to a `User`) — this is the deliberate multi-tenancy seam
(`docs/DATABASE.md`, `docs/SECURITY.md` §7). Every downstream entity
(`Transcript`, `ClipCandidate`, `GeneratedContent`, etc.) traces back to a
`ProcessingJob` → `MediaAsset` → `Project` → `Workspace`, which is the
ownership chain every authorization check walks.

## 4. API map (see `docs/API.md` for full request/response detail)

```
Auth          POST /auth/register · POST /auth/login · POST /auth/refresh
              POST /auth/logout · GET /auth/me

Projects      GET/POST /projects · GET/PATCH/DELETE /projects/:id

Uploads       POST /projects/:id/media · GET /media/:id

Jobs          GET /jobs/:id · GET /jobs/:id/events
              POST /jobs/:id/cancel · POST /jobs/:id/retry

Transcript    GET /jobs/:id/transcript

Clips         GET /jobs/:id/clips · GET/PATCH /clips/:id
              POST /clips/:id/render · GET /clips/:id/download

Content       GET /jobs/:id/content · PATCH /content/:id
              POST /jobs/:id/content/:type/regenerate
              GET /content/:id/export

Usage         GET /usage
```

## 5. Queue / job map (see `docs/QUEUE.md` for retry/concurrency detail)

```
video.validate → audio.extract → transcription.process → content.analyze
                                                              │
                                        ┌─────────────────────┴─────────────────────┐
                                        ▼                                           ▼
                        clips.detect → clips.score → clip.render (×N fan-out)      content.generate (×5 fan-out)
                                        │                                           │
                                        └─────────────────────┬─────────────────────┘
                                                              ▼
                                                        job.finalize → COMPLETED
```

## 6. Development milestones, in dependency order

Each milestone is meant to be independently inspectable/testable before
the next begins, per the brief's "Important Development Rule."

1. **Foundation**: monorepo tooling (workspaces + Turborepo), `packages/config`
   (env validation), `packages/logger`, `packages/db` schema + migrations
   (empty domain tables), Docker Compose for local Postgres/Redis, CI
   skeleton (lint/typecheck/test on PR).
2. **Auth**: `users`/`workspaces`/`workspace_members` tables, register/
   login/refresh/logout/me endpoints, JWT + refresh rotation
   (ADR-001), password hashing, auth-specific rate limiting.
3. **Projects & dashboard read path**: `projects` table + CRUD endpoints,
   ownership-check middleware pattern established here (reused by every
   subsequent resource), minimal frontend dashboard/project screens.
4. **Upload pipeline (no AI yet)**: `media_assets`/`processing_jobs`/
   `processing_job_events` tables, `StorageDriver` (local disk first,
   ADR-007), upload endpoint with streaming + size/type validation,
   `video.validate` worker job, state machine skeleton through
   `AUDIO_EXTRACTED` (upload → validate → extract audio only — proves the
   queue/worker/state-machine plumbing end-to-end before any paid AI call
   exists).
5. **Transcription**: `TranscriptionProvider` abstraction + local Whisper
   implementation (zero-cost dev default), `transcripts`/
   `transcript_segments` tables, `transcription.process` job, transcript
   API endpoint, idempotency-by-checksum proven here first (cheapest place
   to get this right before AI stages depend on the same pattern).
6. **AI layer foundation**: `AIProvider` interface + Gemini adapter
   (ADR-006), `packages/ai` schemas, usage/token accounting wired to
   `usage_records`, quota-check middleware (`docs/COST.md`) — built and
   tested before any AI-dependent pipeline stage uses it.
7. **Content analysis + clip detection/scoring**: `content_analyses`/
   `clip_candidates` tables, `content.analyze` → `clips.detect` →
   `clips.score` jobs, deterministic post-processing/clamping
   (`docs/AI.md` §4) — this is where the "AI proposes, code disposes"
   pattern gets proven end-to-end.
8. **Clip rendering**: `MediaProcessor` FFmpeg wrapper (ADR / security
   model from `docs/SECURITY.md` §4 implemented here), `generated_clips`
   table, `clip.render` fan-out jobs, clip review/edit/re-render API +
   frontend preview.
9. **Written content generation**: `generated_content` table,
   `content.generate` fan-out jobs (5 content types), review/edit/
   regenerate/export API + frontend.
10. **Finalization, quotas end-to-end, error handling polish**:
    `job.finalize`, `processing_errors` table, full retry/cancel API,
    usage dashboard endpoint, frontend status polling with the
    state-group mapping (`docs/PIPELINE.md` §2), empty/error/retry UI
    states across the app.
11. **Hardening pass**: security review against `docs/SECURITY.md`
    checklist, load-test the queue concurrency defaults, verify
    idempotency under forced retries/crashes, confirm quota enforcement
    can't be bypassed by any request-ordering race.

Milestones 1–4 establish plumbing with no AI cost risk at all. Milestone 5
is the first stage with any external-API-shaped cost (mitigated to zero by
defaulting to local Whisper). Milestones 6–9 are where the product's actual
value is built, each independently testable. Milestone 10–11 close the gap
between "features work" and the brief's Definition of Done.

---

**Status**: architecture design complete. No implementation code has been
written. Awaiting the next instruction to begin Milestone 1.
