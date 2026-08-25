# Contento AI

AI-powered content repurposing platform.

Upload a long-form video → the system transcribes it, analyzes it for
valuable moments, generates vertical short-form clips with captions, and
generates written content (blog post, LinkedIn post, X/Twitter post,
Instagram caption, YouTube description) from the same source — all
reviewable and exportable from a single dashboard.

## Status

🚧 Early development. Architecture is being built incrementally, milestone
by milestone. See `docs/ARCHITECTURE.md` (added once the architecture
design phase is complete) for system design decisions.

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
