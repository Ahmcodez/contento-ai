# ADR-004: BullMQ (Redis-backed) over SQS/RabbitMQ/rolling our own

## Decision
Use BullMQ, backed by Redis, for all asynchronous job processing.

## Alternatives considered
1. **AWS SQS** (+ Lambda or long-running consumers).
2. **RabbitMQ** (dedicated message broker).
3. **BullMQ on Redis** (chosen).
4. **Hand-rolled DB-polling job table** (a `jobs` table, workers poll for
   `status = 'pending'`).

## Reasoning
- SQS introduces a cloud vendor dependency and cost surface before it's
  needed, and complicates local/free-tier development (LocalStack adds
  setup overhead for something Redis gives us natively and locally).
- RabbitMQ is a legitimate, powerful choice but is another piece of
  infrastructure to run/manage/monitor; Redis is already required for rate
  limiting (`docs/ARCHITECTURE.md` §2.6), so BullMQ reuses infrastructure
  we need anyway rather than adding a new one.
- A hand-rolled DB-polling queue is tempting for "no new infra," but
  reimplements — usually worse — retry/backoff, concurrency control,
  delayed jobs, and progress reporting that BullMQ already provides, and
  DB-polling at any real job volume creates its own performance and
  locking concerns.
- BullMQ specifically (over older `Bull`) has first-class TypeScript
  support, `FlowProducer` for parent/child job trees (needed for the
  fan-out/fan-in pattern in `docs/QUEUE.md` §8), and Bull Board for free
  observability during development.

## Tradeoffs
- Redis becomes a harder dependency (already true for rate limiting, so
  marginal added risk, not new risk).
- BullMQ job data lives in Redis, which is not the system of record —
  by design, every business-meaningful result is persisted to Postgres
  independently (`docs/QUEUE.md` §6 step 5), so Redis can be treated as
  disposable/rebuildable without data loss, but this dual-write discipline
  must be maintained consistently by every processor.
- Scaling BullMQ to very high job volumes eventually requires Redis
  cluster considerations — not a V1 concern (`docs/SCALABILITY.md`).
