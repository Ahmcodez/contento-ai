# ADR-007: StorageDriver abstraction (local disk in dev, S3-compatible in prod)

## Decision
Define a `StorageDriver` interface in `packages/storage` with a
`LocalDiskStorageDriver` (default in dev/test) and an `S3StorageDriver`
(S3-compatible: AWS S3, Backblaze B2, Cloudflare R2, or MinIO), selected
via `STORAGE_DRIVER` env var. No code outside `packages/storage` touches
the filesystem or a storage SDK directly for user media.

## Alternatives considered
1. **Direct filesystem access everywhere media is read/written.**
2. **Commit to a cloud storage provider (e.g. AWS S3) from day one, even
   in local dev.**
3. **`StorageDriver` interface, local disk in dev, S3-compatible in prod**
   (chosen).

## Reasoning
- Option 1 fails the moment the app needs to run anywhere other than a
  single-disk host — no horizontal worker scaling is possible if workers
  need shared filesystem access, and it also scatters filesystem-security
  concerns (`docs/SECURITY.md` §3) across the codebase instead of
  centralizing them in one auditable module.
- Option 2 forces cloud costs and cloud credentials onto local development
  and CI, directly contradicting the cost-architecture requirement to
  design around free-tier/local development.
- Option 3 keeps local dev genuinely free and fast (no network calls for
  media I/O during development) while making the production path
  (S3-compatible storage) a config change, not a code change — and by
  targeting the S3-*compatible* API specifically (not AWS-SDK-specific
  features), it also avoids locking the prod deployment to AWS
  specifically; Backblaze B2/Cloudflare R2 are meaningfully cheaper
  S3-compatible alternatives available without a rewrite.

## Tradeoffs
- The interface must be kept genuinely minimal and lowest-common-
  denominator across local disk and S3 semantics (e.g. no reliance on
  S3-specific features like multipart upload internals leaking into the
  interface) — a real constraint on interface design that must be
  respected as it's implemented, not just declared.
- Local-disk dev behavior (e.g. path handling, concurrent access) will
  never perfectly mirror S3 behavior (e.g. eventual consistency edge
  cases, if any) — acceptable for V1, worth revisiting with a staging
  environment on real S3-compatible storage before production launch.
