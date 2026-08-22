# Database Design

Postgres. Modeled with an ORM (Prisma or Drizzle — decided at
implementation time; this doc is ORM-agnostic). All IDs are UUIDs
(`uuid_generate_v4()` or app-generated ULIDs — ULIDs preferred for natural
sort-by-creation-time, decided at implementation).

## Entity summary

```
User ──< Workspace membership >── Workspace ──< Project ──< MediaAsset ──< ProcessingJob
                                                                              │
                                                                              ├──< Transcript ──< TranscriptSegment
                                                                              ├──< ContentAnalysis
                                                                              ├──< ClipCandidate ──< GeneratedClip
                                                                              ├──< GeneratedContent
                                                                              └──< ProcessingJobEvent

User ──< UsageRecord
User ──< Quota (1:1, or plan-derived — see below)
ProcessingJob ──< ProcessingError
```

### Design note: Workspaces
V1 does not require multi-seat collaboration, but modeling `Workspace` from
day one (with a 1:1 "personal workspace" auto-created per user) means adding
team members later is additive (a new `WorkspaceMember` row type), not a
schema migration that touches every ownership check in the codebase. Every
`Project` belongs to a `Workspace`, never directly to a `User` — this is the
one deliberate "build for later" exception to YAGNI in the schema, because
retrofitting ownership models after the fact is unusually expensive
(touches every authorization check in the app).

---

## Tables

### `users`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext, unique, not null | case-insensitive |
| password_hash | text, not null | argon2id |
| name | text | |
| email_verified_at | timestamptz, nullable | |
| plan | enum(`free`,`pro`) not null default `free` | drives Quota; `pro` unused until payments (out of scope) but modeled now |
| created_at, updated_at | timestamptz | |
- **Relationships**: 1:N `WorkspaceMember`, 1:N `UsageRecord`, 1:1 `Quota` (or derived from `plan` — see Quota below).
- **Indexes**: unique on `email`.
- **Lifecycle**: soft-delete (`deleted_at` nullable) rather than hard delete, so historical `ProcessingJob`/`UsageRecord` rows retain referential integrity for billing/audit even after account deletion.

### `workspaces`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text, not null | |
| owner_id | uuid FK → users.id | |
| is_personal | boolean, not null default true | auto-created 1:1 workspace per user in V1 |
| created_at, updated_at | timestamptz | |
- **Indexes**: index on `owner_id`.
- **Lifecycle**: created automatically at user signup; never deleted while the owner account exists.

### `workspace_members`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK → workspaces.id, not null | |
| user_id | uuid FK → users.id, not null | |
| role | enum(`owner`,`editor`,`viewer`) not null | unused beyond `owner` in V1, modeled for later |
| created_at | timestamptz | |
- **Constraints**: unique (`workspace_id`,`user_id`).
- **Indexes**: index on `user_id` (fast "my workspaces" lookup).

### `projects`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK → workspaces.id, not null | |
| title | text, not null | |
| description | text, nullable | |
| status | enum(`active`,`archived`) not null default `active` | |
| created_by | uuid FK → users.id, not null | |
| created_at, updated_at | timestamptz | |
- **Relationships**: 1:N `MediaAsset`.
- **Indexes**: index on `workspace_id`; index on (`workspace_id`,`status`) for dashboard filtering.
- **Lifecycle**: archived, not deleted, on user "delete" action in V1 (hard delete deferred — media cleanup on hard delete needs its own careful job, out of scope for V1).

### `media_assets`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid FK → projects.id, not null | |
| uploaded_by | uuid FK → users.id, not null | |
| original_filename | text, not null | sanitized before storage, never used as the storage path |
| storage_key | text, not null | opaque key into `StorageDriver`, never a client-supplied path |
| mime_type | text, not null | server-verified via magic-byte sniffing, not trusted from `Content-Type` header |
| size_bytes | bigint, not null | server-verified against actual stored size |
| duration_seconds | numeric, nullable | populated after `ffprobe` in VALIDATING |
| checksum_sha256 | text, not null | used for transcription idempotency key |
| status | enum mirrors relevant early pipeline states (`uploading`,`uploaded`,`validating`,`validated`,`rejected`) | |
| rejection_reason | text, nullable | set if validation fails |
| created_at, updated_at | timestamptz | |
- **Indexes**: index on `project_id`; unique on (`project_id`,`checksum_sha256`) to prevent duplicate-upload double-processing within a project.
- **Constraints**: `size_bytes` app-level checked against `MAX_UPLOAD_SIZE_MB` at insert; DB does not enforce business limits (those are configurable at runtime, not schema-fixed) but does enforce `size_bytes >= 0`.

### `processing_jobs`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| media_asset_id | uuid FK → media_assets.id, not null | |
| state | enum, all states from `docs/PIPELINE.md`, not null | |
| failure_stage | text, nullable | state at time of terminal failure |
| error_message | text, nullable | user-facing |
| progress_percent | smallint, not null default 0 | derived/estimated, for UI |
| started_at | timestamptz, nullable | |
| completed_at | timestamptz, nullable | |
| cancelled_at | timestamptz, nullable | |
| created_at, updated_at | timestamptz | |
- **Relationships**: 1:1-ish practically (one active job per media asset at a time, though historically 1:N if reprocessing is allowed later); 1:N `ProcessingJobEvent`, 1:N `ProcessingError`.
- **Indexes**: index on `media_asset_id`; index on `state` (worker/dashboard queries "all jobs currently in X state"); index on `created_at` for ordering.
- **Lifecycle**: append-only history via `ProcessingJobEvent`; the row itself is mutable (current state), never deleted.

### `processing_job_events`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| processing_job_id | uuid FK, not null | |
| from_state | text, nullable | null for the initial event |
| to_state | text, not null | |
| metadata | jsonb, nullable | e.g. retry count, worker id |
| created_at | timestamptz, not null | |
- **Purpose**: append-only audit trail — powers both debugging and a future "processing timeline" UI. Never updated, only inserted.
- **Indexes**: index on `processing_job_id`.

### `transcripts`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| media_asset_id | uuid FK, not null, unique | one transcript per media asset |
| full_text | text, not null | |
| language | text, nullable | detected/declared |
| provider | text, not null | e.g. `whisper-local`, `gemini-audio` — which `TranscriptionProvider` produced this |
| raw_provider_response | jsonb, nullable | for debugging/reprocessing without re-calling the API |
| created_at | timestamptz | |
- **Indexes**: unique on `media_asset_id`.

### `transcript_segments`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| transcript_id | uuid FK, not null | |
| sequence | integer, not null | ordering |
| start_ms | integer, not null | |
| end_ms | integer, not null | |
| text | text, not null | |
| speaker_label | text, nullable | if diarization is available from the provider |
- **Indexes**: index on (`transcript_id`,`sequence`); index on (`transcript_id`,`start_ms`) for range queries ("segments overlapping clip [12.4s, 28.1s]").
- **Constraints**: `end_ms > start_ms`.

### `content_analyses`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| processing_job_id | uuid FK, not null, unique | |
| summary | text, not null | |
| topics | jsonb, not null | string[] |
| key_quotes | jsonb, not null | structured `{text, startMs, endMs}[]` |
| raw_ai_response | jsonb, nullable | |
| ai_provider | text, not null | e.g. `gemini-1.5-pro` |
| created_at | timestamptz | |

### `clip_candidates`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| processing_job_id | uuid FK, not null | |
| start_ms | integer, not null | |
| end_ms | integer, not null | |
| title | text, not null | AI-suggested |
| rationale | text, nullable | why this moment was picked |
| ai_score | numeric, nullable | raw AI-provided score, if any |
| final_score | numeric, not null | post-deterministic-scoring value used for ranking |
| rank | smallint, not null | 1 = best |
| status | enum(`candidate`,`approved_for_render`,`rejected`) not null default `candidate` | |
| created_at | timestamptz | |
- **Indexes**: index on (`processing_job_id`,`rank`).
- **Constraints**: `end_ms > start_ms`; check `end_ms - start_ms` within configured min/max clip length at app level (not hard DB constraint, since limits are configurable).

### `generated_clips`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| clip_candidate_id | uuid FK, not null, unique | |
| storage_key | text, not null | rendered 9:16 file |
| thumbnail_storage_key | text, nullable | |
| duration_seconds | numeric, not null | |
| render_status | enum(`pending`,`rendering`,`rendered`,`failed`) not null | |
| render_error | text, nullable | |
| created_at, updated_at | timestamptz | |
- **Indexes**: unique on `clip_candidate_id`.

### `generated_content`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| processing_job_id | uuid FK, not null | |
| content_type | enum(`blog`,`linkedin`,`x_twitter`,`instagram_caption`,`youtube_description`) not null | |
| body | text, not null | |
| metadata | jsonb, nullable | e.g. hashtags, char count, title (for blog) |
| ai_provider | text, not null | |
| status | enum(`generated`,`edited`,`exported`) not null default `generated` | tracks user review state |
| created_at, updated_at | timestamptz | |
- **Indexes**: index on (`processing_job_id`,`content_type`); unique on (`processing_job_id`,`content_type`) — one generated item per type per job in V1 (regeneration replaces, doesn't duplicate — modeled via update, with prior version optionally kept in a future `generated_content_versions` table, not built in V1).

### `usage_records`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK, not null | |
| category | enum(`upload_minutes`,`ai_requests`,`transcription_minutes`,`clips_rendered`) not null | |
| amount | numeric, not null | |
| processing_job_id | uuid FK, nullable | traceability |
| occurred_on | date, not null | for daily quota rollups |
| created_at | timestamptz | |
- **Purpose**: append-only ledger — quota checks are computed by summing this table (or a materialized daily rollup for performance at scale), never by mutating a running counter, so usage is always auditable and correctable.
- **Indexes**: index on (`user_id`,`category`,`occurred_on`) — the exact shape quota checks query.

### `quotas`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| plan | enum(`free`,`pro`) PK-ish / unique, not null | plan-level, not per-user, in V1 |
| max_upload_duration_seconds | integer, not null | |
| max_upload_size_mb | integer, not null | |
| max_clips_per_video | integer, not null | |
| max_ai_requests_per_day | integer, not null | |
| max_concurrent_jobs | integer, not null | |
- **Design note**: quotas are keyed by `plan`, not by `user_id`, in V1 (all free users share the free-plan quota row). Per-user overrides are deferred — schema allows adding a nullable `user_id` override table later without touching this one.
- **Seeded from env/config** (`docs/COST.md`) at boot/migration time, not hardcoded.

### `processing_errors`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| processing_job_id | uuid FK, not null | |
| stage | text, not null | pipeline state at time of error |
| message | text, not null | user-facing |
| detail | jsonb, nullable | stack trace / provider error body — server-side only, never returned via API |
| retry_count | smallint, not null default 0 | |
| created_at | timestamptz | |
- **Indexes**: index on `processing_job_id`.
- **Purpose**: separates the *detailed* server-side error record from the terse `processing_jobs.error_message` shown to users — keeps stack traces and provider payloads out of any API response while still fully logged for debugging.

---

## Cross-cutting notes

- **Cascade rules**: `ON DELETE CASCADE` from `Project → MediaAsset →
  ProcessingJob → {Transcript, ContentAnalysis, ClipCandidate,
  GeneratedContent}` — but in practice V1 uses soft-delete/archive at the
  `Project` level, so cascade deletes are a safety net for the (rare,
  admin-only) hard-delete path, not the primary deletion UX.
- **Multi-tenancy / row-level isolation**: every query that touches
  `Project` or below is scoped through `workspace_id` (or transitively
  `project_id`) in the repository layer — see `docs/SECURITY.md` §
  ownership checks. This is application-enforced, not DB row-level
  security, in V1 (RLS is a documented option to revisit if the app layer
  ever proves an insufficient boundary — e.g. before adding a raw
  read-replica reporting tool).
- **JSONB usage is deliberate and narrow**: only for genuinely
  variable-shape data (AI raw responses, per-content-type metadata). Every
  field that's queried, filtered, or joined on is a real typed column.
