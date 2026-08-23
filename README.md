# Contento AI

AI-powered content repurposing platform.

Upload a long-form video → the system transcribes it, analyzes it for
valuable moments, generates vertical short-form clips with captions, and
generates written content (blog post, LinkedIn post, X/Twitter post,
Instagram caption, YouTube description) from the same source — all
reviewable and exportable from a single dashboard.

## Status

🚧 Backend foundation implemented and tested (auth, projects, video
upload, async processing pipeline through clip detection). See
[`backend/README.md`](backend/README.md) to run it locally.

Architecture design is complete. Start at **[`docs/SUMMARY.md`](docs/SUMMARY.md)** for
the consolidated architecture overview, diagrams, and the dependency-ordered
development milestones. Full detail:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design & component rationale
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema
- [`docs/PIPELINE.md`](docs/PIPELINE.md) — processing state machine
- [`docs/API.md`](docs/API.md) — REST API design
- [`docs/QUEUE.md`](docs/QUEUE.md) — BullMQ job architecture
- [`docs/AI.md`](docs/AI.md) — AI provider abstraction
- [`docs/COST.md`](docs/COST.md) — cost/quota architecture
- [`docs/SECURITY.md`](docs/SECURITY.md) — security architecture
- [`docs/SCALABILITY.md`](docs/SCALABILITY.md) — scaling path
- [`docs/adr/`](docs/adr/) — architecture decision records

## Core workflow

```
Upload video → Async processing queue → Extract audio → Transcribe
→ Analyze transcript → Detect & score clip candidates → Render vertical
9:16 clips with captions → Generate written content variants
→ User reviews/edits → Export
```

## V1 scope

See project brief (internal) for the full scope. Out of scope for V1:
URL ingestion (YouTube/Vimeo), social publishing, B-roll generation,
AI avatars, and payment processing — the architecture is designed so
these can be added later without major rewrites.

## Development

Setup instructions will be added here once the initial stack is scaffolded.

## Environment variables

Copy `.env.example` to `.env` and fill in values. Never commit `.env` or
real secrets.
