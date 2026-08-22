# ADR-002: Fastify over Express for the API framework

## Decision
Use Fastify as the HTTP framework for `apps/api`.

## Alternatives considered
1. **Express** — the incumbent default, huge ecosystem.
2. **Fastify** (chosen).
3. **NestJS** — full-featured, opinionated, DI-based framework.

## Reasoning
- Express has no built-in schema validation; every project reinvents it,
  usually inconsistently. Fastify has first-class JSON Schema (or Zod via
  a plugin) request/response validation, which directly supports the
  brief's requirement for "typed API contracts where practical" and
  "validate: API request input" without extra scaffolding.
- Fastify's plugin/encapsulation model maps cleanly onto the layered
  `routes → controllers → services → repositories` structure without
  needing a heavier framework's conventions.
- NestJS is a legitimate alternative but its DI container and decorator-
  heavy style is more structure than this project needs at V1 — it would
  be solving an organizational problem the monorepo package boundaries
  (`docs/ARCHITECTURE.md` §4) already solve more simply. Revisit only if
  the team genuinely outgrows the simpler structure.
- Fastify has meaningfully better raw throughput than Express, which
  matters less at V1 scale but costs nothing to get for free now.

## Tradeoffs
- Smaller ecosystem/community than Express (though large and active in
  its own right; not a niche choice).
- Team familiarity: if the team knows Express deeply and not Fastify,
  there's a real (if modest) learning-curve cost — judged worth it for
  the validation/structure benefits above.
