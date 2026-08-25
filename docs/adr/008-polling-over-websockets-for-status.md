# ADR-008: HTTP polling over WebSockets/SSE for processing status (V1)

## Decision
The frontend polls `GET /api/v1/jobs/:jobId` on an interval (with backoff
as a job sits longer in a given state) for processing status in V1, rather
than pushing updates via WebSockets or Server-Sent Events.

## Alternatives considered
1. **WebSockets** — persistent bidirectional connection, server pushes
   state changes.
2. **Server-Sent Events (SSE)** — persistent one-way connection, server
   pushes state changes.
3. **HTTP polling** (chosen for V1).

## Reasoning
- Polling requires zero new infrastructure — it's a plain REST endpoint,
  already stateless, already fits the horizontally-scaled API design
  (`docs/ARCHITECTURE.md` §2.2) with no sticky-session or connection-
  affinity concerns.
- WebSockets/SSE need connection state held somewhere (in-process or in a
  shared pub/sub layer like Redis pub/sub) for the API to notify a
  specific open connection when a *worker* process (a different process
  entirely) completes a stage — solvable, but it's real added complexity
  (a pub/sub bridge between worker and API) for a UX benefit
  (sub-second status updates) that isn't essential: video processing
  pipelines run for tens of seconds to minutes, so a few seconds of
  polling latency is imperceptible relative to the operation itself.
- This keeps V1 simple and defers a genuinely reasonable future
  improvement (SSE specifically, being simpler than WebSockets for a
  one-way status-push use case) until there's evidence the UX gap
  actually matters to users.

## Tradeoffs
- Polling generates more total HTTP requests than a push model —
  mitigated by client-side backoff (poll faster right after a state
  transition is expected, slower during long-running stages) and is
  cheap at V1 request volumes regardless.
- Slightly less "live" feeling UI than push-based updates — an accepted
  UX tradeoff for V1 simplicity, revisit (SSE specifically recommended
  over WebSockets if revisited, since the data flow is one-way
  server→client) once usage data shows it's worth the added
  infrastructure.
