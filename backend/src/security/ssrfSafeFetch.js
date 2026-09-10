const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const ipaddr = require('ipaddr.js');

/**
 * SSRF-safe outbound HTTP(S) fetcher, used by every URL-ingestion
 * provider (src/providers/) whenever it needs to reach a user-supplied
 * URL — metadata HEAD requests, direct-media downloads, and (later)
 * yt-dlp's own network calls stay entirely inside a subprocess, so this
 * module is specifically for requests *this process* makes directly.
 *
 * Every user-supplied URL is treated as fully untrusted per
 * docs/SECURITY.md. Three protections, applied together, close the
 * standard SSRF bypasses:
 *
 *  1. DNS resolution is validated (rejecting loopback/private/
 *     link-local/unique-local/multicast/reserved/carrier-grade-NAT
 *     ranges — this is what blocks e.g. http://169.254.169.254/ cloud
 *     metadata endpoints and http://localhost/ alike) *before* any
 *     connection is attempted.
 *  2. The connection is pinned to the exact validated IP via Node's
 *     `lookup` request option, rather than letting the underlying
 *     socket re-resolve the hostname at connect time. Without this, an
 *     attacker-controlled DNS record can pass validation, then change
 *     to a private IP by the time the actual TCP connect happens
 *     (DNS rebinding) — validating and connecting have to be the same
 *     resolution, not two separate lookups.
 *  3. Every redirect hop is treated as a brand new untrusted URL and
 *     re-validated from scratch (steps 1+2 again) up to a fixed
 *     redirect limit. A server that returns 200 for the initial
 *     validation request and then 302s to an internal address is a
 *     documented real-world SSRF technique — redirects are exactly as
 *     dangerous as the original URL.
 *
 * Only plain http:// and https:// are ever accepted (no file://,
 * gopher://, ftp://, data:, etc. — those aren't "URL scheme quirks",
 * they're a different attack surface entirely and are rejected outright
 * before any network access is attempted).
 */

class SsrfBlockedError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
  }
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * ipaddr.js classifies every address into a named range ('private',
 * 'loopback', 'linkLocal', 'uniqueLocal', 'carrierGradeNat', 'reserved',
 * 'multicast', 'broadcast', 'unspecified', 'unicast', ...). 'unicast' is
 * the only range that means "ordinary public, globally routable
 * address" for both IPv4 and IPv6 — everything else is some form of
 * non-public address space and is blocked. ipaddr.process() also
 * normalizes IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) down to their
 * IPv4 form first, closing a classic mapped-address bypass of a naive
 * IPv6-unaware check.
 */
function isPublicAddress(address) {
  try {
    const addr = ipaddr.process(address);
    return addr.range() === 'unicast';
  } catch {
    return false;
  }
}

/**
 * Resolves `hostname` and returns the first address that passes
 * isPublicAddress, or throws SsrfBlockedError if none do (including the
 * case where the hostname doesn't resolve at all). Deliberately does not
 * return every address / let the caller pick — the same single validated
 * address is what gets pinned for the actual connection, so there's only
 * ever one resolution in play, never a second independent one.
 */
async function resolveValidatedAddress(hostname) {
  let results;
  try {
    results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve host "${hostname}"`, 'dns_resolution_failed');
  }

  // Referenced via module.exports (not the bare local function) so
  // tests can seam just the address-classification policy — e.g. to
  // treat a local test server's loopback address as "public" for a
  // controlled integration test — without touching DNS or the real
  // request/redirect/streaming logic at all.
  const valid = results.find((r) => module.exports.isPublicAddress(r.address));
  if (!valid) {
    throw new SsrfBlockedError(
      `The host "${hostname}" resolves to a private, reserved, or otherwise disallowed address`,
      'private_address_blocked',
    );
  }
  return valid;
}

function assertHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Not a valid URL', 'invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`, 'unsupported_scheme');
  }
  return parsed;
}

/**
 * Validates a URL (scheme + DNS) without making a request. Used by
 * providers/ProviderResolver to reject a URL immediately on paste,
 * before any metadata fetch is attempted.
 */
async function validateUrl(rawUrl) {
  const parsed = assertHttpUrl(rawUrl);
  const resolved = await resolveValidatedAddress(parsed.hostname);
  return { parsed, resolved };
}

/**
 * Performs one validated, pinned HTTP(S) request (no redirect handling —
 * that's layered on top by request()). Returns the raw http.IncomingMessage
 * so callers can either buffer it (metadata) or pipe it (download).
 */
function rawRequest(parsedUrl, resolvedAddress, { method = 'GET', headers = {}, timeoutMs = 15000 } = {}) {
  const client = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        servername: parsedUrl.hostname, // correct TLS SNI/cert check against the real hostname, even though the socket connects to resolvedAddress
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers: { 'User-Agent': 'ContentoAI-URLImport/1.0', ...headers },
        timeout: timeoutMs,
        // Pins the connection to the address we already validated,
        // instead of letting the socket layer re-resolve the hostname
        // itself — see the module doc comment (protection #2).
        lookup: (_hostname, _options, callback) => callback(null, resolvedAddress.address, resolvedAddress.family),
      },
      (res) => resolve(res),
    );

    req.on('timeout', () => req.destroy(new SsrfBlockedError('Request timed out', 'timeout')));
    req.on('error', (err) => reject(err instanceof SsrfBlockedError ? err : new SsrfBlockedError(`Request failed: ${err.message}`, 'request_failed')));
    req.end();
  });
}

/**
 * Full SSRF-safe request with redirect handling: validates + pins each
 * hop independently, up to maxRedirects. Returns the final
 * http.IncomingMessage (not yet consumed) plus the final resolved URL.
 */
async function request(rawUrl, { method = 'GET', headers = {}, timeoutMs = 15000, maxRedirects = MAX_REDIRECTS } = {}) {
  let currentUrl = rawUrl;
  let currentMethod = method;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = assertHttpUrl(currentUrl);
    const resolved = await resolveValidatedAddress(parsed.hostname);
    const res = await rawRequest(parsed, resolved, { method: currentMethod, headers, timeoutMs });

    if (REDIRECT_STATUS_CODES.has(res.statusCode) && res.headers.location) {
      res.resume(); // discard this response body, we're not using it
      if (hop === maxRedirects) {
        throw new SsrfBlockedError('Too many redirects', 'too_many_redirects');
      }
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      // 303 always downgrades to GET; 301/302 conventionally do too for
      // non-GET/HEAD requests (matching every major HTTP client's
      // behavior, not just browsers) — 307/308 alone preserve method+body.
      if (res.statusCode === 303 || (['POST', 'PUT', 'PATCH', 'DELETE'].includes(currentMethod) && (res.statusCode === 301 || res.statusCode === 302))) {
        currentMethod = 'GET';
      }
      continue;
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new SsrfBlockedError('Too many redirects', 'too_many_redirects');
}

/**
 * HEAD request for cheap metadata (Content-Length, Content-Type) without
 * downloading the body — used by DirectMediaProvider.getMetadata.
 */
async function fetchHeaders(rawUrl, opts = {}) {
  const { response, finalUrl } = await request(rawUrl, { ...opts, method: 'HEAD' });
  response.resume(); // HEAD has no body, but drain defensively
  return { statusCode: response.statusCode, headers: response.headers, finalUrl };
}

/**
 * Streams a GET response body to destPath, enforcing maxBytes while
 * streaming (aborting and deleting the partial file the instant the
 * limit is crossed, rather than downloading the whole oversized file
 * first and rejecting it after the fact) and an overall timeout.
 */
async function downloadToFile(rawUrl, destPath, { maxBytes, timeoutMs = 5 * 60 * 1000, headers = {} } = {}) {
  const { response, finalUrl } = await request(rawUrl, { headers, timeoutMs });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    throw new SsrfBlockedError(`Source returned HTTP ${response.statusCode}`, 'bad_status');
  }

  const contentLength = Number(response.headers['content-length']);
  if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.resume();
    throw new SsrfBlockedError(`Source file is too large (${contentLength} bytes, max ${maxBytes})`, 'too_large');
  }

  let received = 0;
  const writeStream = fs.createWriteStream(destPath);

  await new Promise((resolve, reject) => {
    const cleanupAndReject = (err) => {
      response.destroy();
      writeStream.destroy();
      // Synchronous, and awaited before reject() below fires — callers
      // that check for the partial file's absence immediately after the
      // rejected promise settles (as the "too large" error handling in
      // urlImportDownload.processor.js does) must never see a race where
      // the file still exists a moment after cleanupAndReject ran.
      fs.rmSync(destPath, { force: true });
      reject(err);
    };

    const overallTimeout = setTimeout(() => cleanupAndReject(new SsrfBlockedError('Download timed out', 'timeout')), timeoutMs);

    response.on('data', (chunk) => {
      received += chunk.length;
      if (maxBytes && received > maxBytes) {
        clearTimeout(overallTimeout);
        cleanupAndReject(new SsrfBlockedError(`Source file exceeded the ${maxBytes}-byte limit while downloading`, 'too_large'));
      }
    });
    response.on('error', (err) => {
      clearTimeout(overallTimeout);
      cleanupAndReject(err);
    });
    writeStream.on('error', (err) => {
      clearTimeout(overallTimeout);
      cleanupAndReject(err);
    });
    writeStream.on('finish', () => {
      clearTimeout(overallTimeout);
      resolve();
    });

    response.pipe(writeStream);
  });

  return { bytesWritten: received, finalUrl, contentType: response.headers['content-type'] };
}

module.exports = {
  SsrfBlockedError,
  isPublicAddress,
  resolveValidatedAddress,
  validateUrl,
  request,
  fetchHeaders,
  downloadToFile,
};
