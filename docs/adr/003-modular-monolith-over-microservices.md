# ADR-003: Modular monolith (API + worker, shared packages) over microservices

## Decision
Build one modular monorepo with two deployable runtime units in V1 (API,
worker), sharing domain code via internal packages, rather than splitting
transcription/analysis/rendering/content-generation into independently
deployed services.

## Alternatives considered
1. **Microservices per pipeline stage** (transcription-service,
   analysis-service, render-service, content-service, each with its own
   deployment, and either its own DB or a shared DB accessed over the
   network).
2. **Single monolithic process** (API and worker in one process, one
   deployable unit).
3. **Modular monolith: two deployable units (API, worker), shared internal
   packages** (chosen).

## Reasoning
- The brief explicitly instructs against unnecessary microservices and
  unnecessary cloud infrastructure. At 10–1,000 users (the realistic V1–V2
  range), microservices add distributed-systems complexity — network
  calls replacing function calls, distributed tracing needs, independent
  deployment/versioning coordination, service-to-service auth — without a
  corresponding benefit, since there's no team-scaling or independent-
  release-cadence pressure yet that microservices are meant to solve.
- Option 2 (single process) fails a harder requirement: "never make the
  main HTTP request wait for a long video-processing operation." A pure
  single-process design without a queue would either block requests or
  require in-process background job handling that reinvents a worse
  version of BullMQ.
- Option 3 gets the actual benefit people reach for microservices for —
  independent scaling of heavy background work — via the queue boundary,
  while keeping one shared domain model, one shared type system, one
  shared test suite, and one deployment pipeline (until real evidence says
  otherwise, see `docs/SCALABILITY.md`).

## Tradeoffs
- Both `apps/api` and `apps/worker` deploy from the same codebase/image
  family, so a change to shared `packages/*` code requires redeploying
  (or at least redeploying awareness of) both — a coordination cost real
  microservices with independent versioned contracts don't have. Mitigated
  by CI running the full test suite across both apps on every change.
- If the team ever does need to scale one pipeline stage independently at
  the *process* level with different infra (e.g. GPU workers for
  transcription), that's still possible today via separate worker deploy
  configs (`docs/SCALABILITY.md` "100 users" tier) without needing a full
  service split — but a genuine service split, if ever warranted
  (`docs/SCALABILITY.md` "10,000 users" tier), will require deliberate
  API/contract design work at that time, which this decision defers
  rather than avoids.
