# Deployment

Two clearly separate architectures: **development** (this repo's
`docker-compose.yml`, everything free/local) and **production** (managed
services, no self-hosted stateful infrastructure). Do not run the
development Docker setup in production — it uses bind mounts, a bare
Postgres/Redis container with a persistent-but-unmanaged volume, and
`nodemon`, none of which are what you want under real traffic.

## Development: Docker

```bash
cp backend/.env.example backend/.env   # fill in real JWT secrets at minimum
docker compose up
```

This starts four containers:

| Service | Image | Purpose |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Dev database, persisted to a named volume (`contento_pgdata`) |
| `redis` | `redis:7-alpine` | BullMQ + rate limiting |
| `backend` | built from `backend/Dockerfile` | API, `nodemon`-watched, port 4000 |
| `worker` | same image, different command | Pipeline processors — needs FFmpeg, which is installed in the image |

`backend` and `worker` share a named volume (`contento_storage`) mounted
at `/app/storage` — this matters because they're separate containers, and
the local-disk `StorageDriver` has no built-in way to share files across
containers; without the shared volume, a file the API writes would be
invisible to the worker that's supposed to process it.

`DATABASE_URL`/`REDIS_URL` are overridden in `docker-compose.yml` to
point at the service hostnames (`postgres`, `redis`) regardless of what's
in `backend/.env` — so the same `.env` file works whether you run the app
via Docker or directly with `npm run dev` (see `backend/README.md`).

**Migrations** aren't run automatically on container start (deliberately
— auto-migrating on boot is a footgun in any environment with more than
one instance). Run them explicitly:

```bash
docker compose exec backend npx knex migrate:latest
```

**Caveat**: this compose file has been validated for YAML correctness and
reviewed carefully for configuration logic, but has not been run
end-to-end in this development environment (no Docker daemon available
here). Before relying on it, do a local `docker compose up` and confirm
the full pipeline (upload → worker picks it up → processes) on your own
machine.

## Development: without Docker

See `backend/README.md` and `frontend/README.md` — running Postgres,
Redis, and FFmpeg natively and starting the API/worker/frontend as plain
Node processes. Both paths are fully supported; Docker is for convenience
and environment consistency, not a requirement.

## Production architecture

```
                    ┌─────────────────┐
                    │   Frontend        │  Vercel (Next.js) — free tier
                    │   (Next.js)        │  covers this comfortably
                    └────────┬────────┘
                             │ HTTPS
                    ┌────────▼────────┐
                    │   API (stateless)  │  containerized, N instances,
                    │                    │  autoscaled on request volume
                    └───┬────────────┬──┘
                        │            │
              ┌─────────▼──┐   ┌─────▼──────┐
              │  Postgres    │   │   Redis      │  both managed —
              │  (managed)   │   │  (managed)   │  no self-hosted
              └────────────┘   └─────┬──────┘  stateful services
                                     │
                            ┌────────▼────────┐
                            │  Worker (stateless) │  same image as API,
                            │                     │  different command,
                            └────────┬────────┘  scaled by queue depth
                                     │
                            ┌────────▼────────┐
                            │  S3-compatible      │  Backblaze B2 or
                            │  object storage       │  Cloudflare R2 —
                            └────────────────────┘  see ADR-011
```

This mirrors `docs/SCALABILITY.md`'s "100 users" tier — nothing here is
premature. No Kubernetes, no service mesh, no separate microservices per
pipeline stage (see ADR-003).

### Recommended free/low-cost providers for this specific stack

| Component | Suggestion | Why | Free tier fit |
|---|---|---|---|
| API + worker containers | Fly.io or Railway | Both deploy a Dockerfile directly with minimal config, support background workers as a separate process from the same image, and have real (not trial) free/hobby tiers | Fly.io: free allowance covers small always-on instances. Railway: usage-based free credit, good for intermittent dev/staging traffic. |
| Postgres | Neon or Supabase | Serverless/managed Postgres with a genuine free tier (not just a trial), branching (Neon) useful for preview environments | Both comfortably cover this schema's size at low user counts |
| Redis | Upstash | Serverless Redis, free tier, billed per-request rather than per-hour — fits BullMQ's bursty usage pattern better than an always-on Redis instance would need to be paid for | Free tier request allowance is generous for this queue volume |
| Object storage | Backblaze B2 or Cloudflare R2 | Both S3-compatible (works with `S3StorageDriver` unmodified via `S3_ENDPOINT`), both meaningfully cheaper than AWS S3, R2 has zero egress fees | Both have real free tiers (B2: 10GB free; R2: 10GB free + no egress cost ever, which matters for a video product) |
| Frontend | Vercel | Built for Next.js specifically, zero-config deploy from this repo's `frontend/` directory | Free tier is generous for a project this size |
| Transcription | Local Whisper on the worker, or defer | Avoids a per-minute hosted STT bill entirely during development/early production — see `docs/COST.md` §1 | Free (compute cost only) |
| AI (Gemini) | Pay-as-you-go, gated by this project's own quota system | No free tier that makes sense to depend on for a real product, but `MAX_AI_REQUESTS_PER_USER_PER_DAY` / `MAX_AI_CALLS_PER_JOB` cap exposure regardless of provider pricing | N/A — cost-controlled by the app itself, see `docs/COST.md` |

**Nothing here is expensive infrastructure added "just in case."** Every
recommendation is chosen specifically because it has a real free or
low-cost tier that fits this project's actual traffic shape (bursty
background processing, not constant high-throughput serving), consistent
with the brief's cost-architecture requirement from day one
(`docs/COST.md`, `docs/ARCHITECTURE.md`).

### What changes between environments

| | Development | Production |
|---|---|---|
| Postgres/Redis | Docker containers, local disk | Managed (Neon/Supabase + Upstash) |
| Storage | Local disk (`STORAGE_DRIVER=local`) | S3-compatible (`STORAGE_DRIVER=s3`) |
| Secrets | `.env` file (gitignored) | Platform secret manager (Fly/Railway secrets, Vercel env vars) |
| Scaling | Single instance each | API autoscaled on request volume; worker scaled independently on queue depth (`docs/SCALABILITY.md`) |
| AI/transcription | Off by default | Configured with real keys, gated by quotas |

## Migration instructions (any environment)

```bash
# apply all pending migrations
npx knex migrate:latest

# roll back the most recent batch
npx knex migrate:rollback

# create a new migration file
npx knex migrate:make descriptive_name
```

Migrations are plain SQL/JS (Knex, not Prisma — see ADR-009), reviewed as
normal PRs. There is no auto-migrate-on-deploy step configured
anywhere in this repo — run migrations as an explicit step in whatever
deploy process you set up, before the new API/worker version starts
receiving traffic.
