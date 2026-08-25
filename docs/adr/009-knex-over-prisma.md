# ADR-009: Knex over Prisma for the data-access layer

## Decision
Use Knex (query builder + SQL migrations) over `pg`, instead of Prisma, for
`packages`/`backend` data access.

## Alternatives considered
1. **Prisma** (original preference in ARCHITECTURE.md/ADR-005).
2. **Knex + pg** (chosen).
3. **Raw `pg` with hand-written SQL, no query builder.**

## Reasoning
Prisma's CLI (`generate`/`migrate`) needs to download prebuilt query-engine
binaries from Prisma's own CDN at install/generate time. In the actual
development sandbox this code is being built in, that CDN isn't reachable
(network egress is allowlisted to package registries, not arbitrary
vendor CDNs), so `prisma generate` fails outright before any app code can
even import `@prisma/client`. That's a real, reproducible blocker, not a
style preference.

Knex has no code-generation step and no native binary — it's a pure JS
query builder over `pg`, so it installs and runs the same way `express`
does. It keeps the same repository-pattern boundary the architecture
already called for (`packages/db` / `src/repositories` as the only layer
touching SQL), with plain, reviewable SQL migrations instead of a DSL.
Raw `pg` alone (option 3) was rejected only because Knex's migration
runner and query builder remove a meaningful amount of repetitive,
error-prone SQL string assembly for no real cost.

## Tradeoffs
- Lose Prisma's generated TypeScript types and schema-driven autocomplete
  — acceptable since the stack was moved to plain JavaScript for this
  implementation anyway.
- Migrations are hand-written SQL/JS files, not diffed automatically from
  a schema file — more manual, but transparent and easy to review in PRs.
- If a future environment has full network access, Prisma remains a
  reasonable thing to revisit — this decision is environment-driven, not
  a rejection of Prisma on its merits.
