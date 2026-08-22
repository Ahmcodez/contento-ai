# ADR-005: PostgreSQL over a NoSQL document store

## Decision
Use PostgreSQL as the single system of record for all structured/
relational data, with `JSONB` used narrowly for genuinely variable-shape
data (raw AI provider responses, per-content-type metadata).

## Alternatives considered
1. **MongoDB** (or another document store) as the primary database.
2. **PostgreSQL** (chosen).
3. **Postgres + a separate document store for AI outputs** (polyglot
   persistence from day one).

## Reasoning
- The domain (`docs/DATABASE.md`) is deeply relational: users → workspaces
  → projects → media assets → processing jobs → transcripts → segments →
  clip candidates → generated clips/content, with real referential
  integrity requirements (cascade behavior, uniqueness constraints like
  one-transcript-per-asset, foreign-key-enforced ownership chains that
  security depends on — `docs/SECURITY.md` §2). Modeling this in a
  document store means reimplementing relational integrity in application
  code, which is strictly worse for a system where authorization
  correctness matters this much.
- Postgres's `JSONB` support means we don't lose flexibility where we
  genuinely want it (AI raw responses, provider-specific metadata) — we
  get a relational core with an escape hatch, rather than a document store
  with bolted-on relational emulation.
- Free-tier availability is excellent (Supabase, Neon, Railway) and local
  Docker setup is trivial, satisfying the cost-architecture requirement.
- Polyglot persistence from day one (option 3) is exactly the kind of
  premature infrastructure the brief warns against — a second database to
  operate, back up, and keep consistent with the first, for a benefit
  (schema flexibility on AI outputs) that `JSONB` already provides within
  one database.

## Tradeoffs
- Postgres requires actual schema migrations for structural changes
  (versus a document store's implicit schema flexibility) — accepted as a
  feature, not a cost, given how much authorization/integrity logic
  depends on the schema being explicit and enforced.
- At extreme write volumes on append-only tables (`usage_records`,
  `processing_job_events`), a specialized store might eventually
  outperform Postgres — explicitly deferred to `docs/SCALABILITY.md`'s
  10,000-user tier as a data-driven future decision, not a V1 concern.
