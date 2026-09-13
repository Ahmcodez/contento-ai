const { z } = require('zod');

// url().max(2048) rejects obvious garbage/oversized input cheaply and
// synchronously; the real, expensive validation (DNS resolution, SSRF
// checks, actually reaching the host) happens once the request is
// already queued (urlImportResolve.processor.js) — this schema only
// needs to catch "clearly not a URL at all" before a job is even
// created, and reject non-http(s) schemes as early as possible (a
// zod .url() check alone accepts file:///etc/passwd, ftp://, etc.).
const pasteUrlBody = z.object({
  body: z.object({
    url: z
      .string()
      .trim()
      .max(2048, 'URL is too long')
      .url('Not a valid URL')
      .refine((value) => value.startsWith('http://') || value.startsWith('https://'), 'Only http and https URLs are supported'),
  }),
});

const mediaImportIdParam = z.object({ params: z.object({ mediaImportId: z.string().uuid() }) });

module.exports = { pasteUrlBody, mediaImportIdParam };
