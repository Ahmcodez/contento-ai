# ADR-001: JWT access tokens + rotating refresh tokens (not server-side sessions)

## Decision
Use short-lived JWT access tokens for API authentication, paired with a
longer-lived refresh token stored in an httpOnly cookie, rotated on every
use and tracked in a DB revocation table.

## Alternatives considered
1. **Server-side sessions** (session ID in cookie, session data in
   Redis/Postgres, looked up on every request).
2. **Long-lived JWT only**, no refresh token, no rotation.
3. **JWT + refresh with rotation** (chosen).

## Reasoning
- Pure server-side sessions require a lookup on every authenticated
  request, which is fine at small scale but adds a stateful dependency to
  every API call as the system scales horizontally (§ `docs/SCALABILITY.md`).
- Long-lived JWT with no refresh/rotation is simple but has a bad security
  property: a leaked token is valid until it naturally expires, with no
  practical revocation mechanism short of rotating the signing secret
  (which invalidates every user's session at once).
- The chosen approach gets most of the statelessness benefit of JWT
  (access-token validation is a local signature check, no DB hit) while
  keeping a real revocation mechanism (the refresh-token table), and
  limits the blast radius of a leaked access token to its short TTL.

## Tradeoffs
- More moving parts than a single long-lived token (refresh endpoint,
  rotation logic, revocation table).
- Requires careful cookie configuration (httpOnly, secure, sameSite) to
  actually deliver the intended security properties — a genuine
  implementation risk to get right, called out here so it isn't
  glossed over later.
- Slightly more complex frontend logic (silent refresh on 401) versus a
  single static token.
