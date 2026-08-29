# ADR-011: Implement a real S3-compatible storage driver

## Decision
Implement `S3StorageDriver` as a second, real `StorageDriver`
implementation (alongside `LocalDiskStorageDriver`), targeting the
S3-compatible API surface rather than AWS-specific features, selected via
`STORAGE_DRIVER=s3` plus `S3_ENDPOINT` for non-AWS providers.

## Alternatives considered
1. **Leave the interface with only a local-disk implementation** until a
   production deployment actually needs cloud storage.
2. **Implement a real S3-compatible driver now** (chosen).
3. **Implement a provider-specific driver for one named vendor** (e.g. an
   AWS-only driver using AWS-specific SDK features).

## Reasoning
`docs/adr/007-storage-driver-abstraction.md` already committed to this
seam existing — but an interface with a single implementation is only a
promise, not a proof, that the abstraction actually holds. Writing the
second implementation now, while the surface area is still small, is the
cheapest time to find out whether the interface leaks local-disk
assumptions (it does, in exactly one place — `getAbsolutePath()`, needed
because FFmpeg requires a real file path; documented directly in the
driver rather than hidden). Waiting until a real production deployment
needs this would mean discovering that leak under deadline pressure
instead of during infrastructure work.

Targeting the S3-*compatible* API (option 3 rejected) keeps the same
non-lock-in property `docs/ARCHITECTURE.md` §2.5 already called for:
Backblaze B2 and Cloudflare R2 are meaningfully cheaper than AWS S3 for
this workload and both work through this driver via `S3_ENDPOINT` with no
code change — a real cost-control lever the storage abstraction was
supposed to preserve.

## Tradeoffs
- `getAbsolutePath()` downloads the full object to a local temp file on
  every call — correct, but means every FFmpeg operation against
  S3-backed storage pays a download (and, for renders, a re-upload) that
  local-disk storage doesn't. Acceptable for V1; a future optimization
  could stream directly where FFmpeg supports it, or co-locate compute
  with storage.
- No integration test against a real S3-compatible endpoint exists yet —
  this sandbox has no credentials or network path to one. Tests mock the
  AWS SDK client at the boundary, which proves the driver's own logic is
  correct but not the real network integration. Recommended before first
  production use: a manual smoke test against the actual configured
  bucket.
