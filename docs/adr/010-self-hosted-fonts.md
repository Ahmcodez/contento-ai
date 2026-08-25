# ADR-010: Self-hosted fonts via @fontsource instead of next/font/google

## Decision
Load Fraunces, Public Sans, and IBM Plex Mono via `@fontsource/*` npm
packages (self-hosted font files bundled at build time) instead of
`next/font/google` (which fetches font CSS/files from
`fonts.googleapis.com` at build time).

## Alternatives considered
1. **`next/font/google`** (Next.js's built-in Google Fonts integration).
2. **`@fontsource/*` packages** (chosen).
3. **System font stack only**, no custom display/mono faces.

## Reasoning
Same root cause as ADR-009 (Prisma): this sandbox's network egress is
allowlisted to package registries, not arbitrary vendor CDNs.
`next/font/google` fetches font files from `fonts.googleapis.com` during
`next build`, which isn't reachable here, and the build fails outright.
`@fontsource` packages ship the actual `.woff2` files as npm package
contents — installed the same way `next`/`react` are, no separate CDN
fetch at build or runtime. This also happens to be a legitimate
production choice independent of the sandbox constraint: self-hosted
fonts avoid a runtime dependency on Google's font CDN and the associated
request waterfall, which `next/font/google` is designed to mitigate but
not eliminate.

Option 3 was rejected on the design brief's own terms — "do not use a
default-looking font stack without considering the product identity" and
typography is called out as a major part of the visual identity.

## Tradeoffs
- Slightly larger `node_modules` (font files ship as package assets).
- No automatic subsetting the way `next/font/google` provides — mitigated
  by only importing the specific weights actually used (see
  `src/app/layout.js`) rather than every available weight.
- If a future environment has full network access, `next/font/google` is
  a reasonable thing to revisit, but self-hosting is not strictly worse —
  this decision is not purely environment-driven the way ADR-009 was.
