# Security Audit — Findings & Fixes

Audit date: 2026-08-29. Scope: full application (auth, authorization, file
upload, FFmpeg usage, API surface, AI pipeline, secrets, dependencies), per
the checklist in `docs/adr/` conventions. Full backend suite: 219/219
passing after fixes (`cd backend && npx jest --runInBand`).

## Fixed this pass

| # | Finding | Severity | Affected files | Fix | Proof |
|---|---|---|---|---|---|
| 1 | `file-type` dependency infinite-loop DoS (GHSA-5v7r-6r5c-r473), reachable on untrusted upload bytes during format auto-detection, before the extension/MIME allowlist runs | Moderate | `backend/src/services/media.service.js`, `package.json` | Removed the dependency; replaced with a scoped, dependency-free magic-byte sniffer for exactly the 4 formats we accept (`backend/src/utils/detectVideoContainer.js`) | `backend/test/detectVideoContainer.test.js` (13 tests), incl. an adversarial-input timing guard |
| 2 | Two high-severity Next.js advisories (SSRF/cache-poisoning/DoS) unfixed even at the latest 14.2.x patch; PostCSS bundled transitively also flagged | High | `frontend/package.json` | Upgraded `next` 14.2.5→16.3.3, `react`/`react-dom` 18→19 | `npm audit` clean (0 vulnerabilities); `npm run build` compiles with no code changes |
| 3 | Prompt injection: transcript text concatenated directly into AI prompts with no system-level separation from instructions and no delimiters | High | `contentAnalysis.service.js`, `clipDetection.service.js`, `contentGeneration.service.js`, `GeminiProvider.js` | Added shared system prompt + `<transcript>` delimiters (`backend/src/ai/promptSafety.js`), wired into every live call site | `backend/test/promptInjectionDefense.test.js` (7 tests) — proves the system prompt and delimiters reach the real Gemini request body, using an actual injection payload as the transcript |
| 4 | Rate limiting keys on `req.ip` but Express `trust proxy` was never configured; in production (behind a load balancer per `docs/DEPLOYMENT.md`), every request looks like it comes from the same IP | Medium | `backend/src/app.js`, `src/config/index.js` | Added configurable `TRUST_PROXY` env var, applied via `app.set('trust proxy', ...)` before the rate limiter runs | `backend/test/trustProxy.test.js` (10 tests) |
| 5 | Root `.env.example` used stale variable names (`JWT_SECRET`/`JWT_EXPIRES_IN`) that don't match the real config schema | Low | `.env.example` | Replaced with a pointer to the real, per-service `backend/.env.example` / `frontend/.env.example` | Manual inspection |

## Reviewed, no changes needed

- **Authorization** — every project/media/transcript/clip/content query is
  scoped through the owning workspace/user id at the repository layer
  (`workspace.repository.js`, `project.repository.js`, etc.), and
  cross-user access consistently returns 404 rather than 403 (no
  existence leak). Verified against `upload.test.js`'s
  "rejects an upload to a project owned by someone else" case and similar
  tests across other resource types.
- **Auth/sessions** — httpOnly + `sameSite: strict` cookies, `secure` in
  production, refresh-token rotation with revocation on use, bcrypt cost
  12, JWT algorithm pinned (not left to the token header), access tokens
  short-lived.
- **File upload** — extension allowlist, MIME allowlist, size limit,
  duration checked via ffprobe before pipeline work begins, filenames
  sanitized before use in paths/headers, uploads written to a per-request
  temp path, no path traversal in storage key construction.
- **FFmpeg** — invoked via `execFile` (no shell interpolation), all
  user-influenced values passed as discrete argv entries, subtitle file
  paths escaped, per-invocation timeouts.
- **Secrets** — `.env` correctly gitignored and never committed (checked
  full git history, not just working tree); `.env.example` files (now)
  contain only placeholders; no hardcoded keys/tokens found anywhere in
  tracked files.
- **Frontend** — tokens held in memory only (never `localStorage`), no
  `dangerouslySetInnerHTML` anywhere in the codebase.

## Known limitation of this pass

Prompt-injection delimiters and system-prompt instructions are a real,
standard mitigation but not a guarantee against a sufficiently determined
attempt — they reduce risk, they don't eliminate the underlying class of
issue. The existing output-side controls (zod schema validation on
structured AI output, deterministic clamping of clip candidates, grounding
instructions + explicit "output only the requested content" rule on
free-text generation) remain the second line of defense and were not
weakened by this change.
